import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import {Pool} from 'pg';
import { db } from './db';
import {z} from 'zod';
import { generateRegistrationOptions } from '@simplewebauthn/server';
import { createHash, randomBytes , randomUUID} from 'node:crypto';
import { verifyRegistrationResponse } from '@simplewebauthn/server';
import { generateAuthenticationOptions } from '@simplewebauthn/server';
import cookieParser from 'cookie-parser';
import crypto from 'node:crypto';
import { verifyAuthenticationResponse } from '@simplewebauthn/server';
const app=express();
app.use(cors({origin:'http://localhost:5173',credentials:true}));
app.use(express.json());
app.use(cookieParser());

const SESSION_TTL_MS=Number(process.env.SESSION_TTL_HOURS!)*3600_000;
const registerOptionsSchema = z.object({
  username: z.string().min(3).max(30).regex(/^[a-z0-9_]+$/),
  displayName: z.string().min(1).max(60),
});

function hashToken(raw:string):Buffer {
    return crypto.createHash('sha256').update(raw).digest();
}
const registerVerifySchema =z.object({
    flowId:z.string().uuid(),
    response:z.any(),
})
app.get('/health', async (req,res)=>{
    try{
        await db.query('SELECT 1');
        res.json({status:'ok', database:'ok'});
    }
    catch{
        res.status(500).json({status:'ok',databse:'down'});
    }
});

app.post('/register/options', async (req, res) => {
  // 1. Validate — never trust the browser; bad input gets a clean 400.
  const parsed = registerOptionsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid username or displayName' });
  }
  const { username, displayName } = parsed.data;

  // 2. Fail fast on a taken username. (The UNIQUE constraint is the real
  //    enforcer against races; this is just a friendly early error.)
  const taken = await db.query('SELECT 1 FROM users WHERE username = $1', [username]);
  if (taken.rowCount) {
    return res.status(409).json({ error: 'Username is taken' });
  }

  // 3. The durable user doesn't exist yet, but the ceremony needs a stable
  //    user handle — so mint one now and carry it in the pending_* columns.
  const pendingUserId = randomUUID();

  // 4. Build the options. residentKey:'required' = discoverable credential
  //    (usernameless login later); attestationType:'none' = don't fingerprint
  //    the device; userVerification:'preferred' = ask for biometrics when
  //    the authenticator has them.
  const options = await generateRegistrationOptions({
    rpName: process.env.RP_NAME!,
    rpID: process.env.RP_ID!,
    userID: new TextEncoder().encode(pendingUserId),
    userName: username,
    userDisplayName: displayName,
    attestationType: 'none',
    authenticatorSelection: {
      residentKey: 'required',
      userVerification: 'preferred',
    },
  });

  // 5. Store the challenge: binds this options call to the verify call,
  //    expires in 5 minutes, single-use.
  const { rows } = await db.query(
    `INSERT INTO webauthn_challenges
       (ceremony, challenge, pending_user_id, pending_webauthn_user_id,
        pending_username, pending_display_name, expires_at)
     VALUES ('register', $1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [options.challenge, pendingUserId, options.user.id, username,
     displayName, new Date(Date.now() + 5 * 60_000)],
  );




  // 6. flowId lets the verify call find this challenge row.
  res.json({ flowId: rows[0].id, options });
});


app.post('/register/verify', async(req,res)=>{
    const parsed=registerVerifySchema.safeParse(req.body);
    if(!parsed.success){
        return res.status(400).json({error:'Invalid request'});
    }
    const{ flowId, response}=parsed.data;

    const {rows}= await db.query(
        `SELECT * FROM webauthn_challenges
        WHERE id= $1 AND ceremony ='register'
           AND consumed_at IS NULL AND expires_at> now()`,
           [flowId]
    );
    const flow=rows[0];
    if(!flow){
        return res.status(400).json({error:'Challenge not found, expired, or already used'});

    }
    let verification;
    try{
        verification=await verifyRegistrationResponse({
            response,
            expectedChallenge: flow.challenge,
            expectedOrigin:process.env.EXPECTED_ORIGIN!,
            expectedRPID:process.env.RP_ID!,
            requireUserVerification:true,
        });
    }
    catch{
        return res.status(400).json({error:'Registration could not be verified'})
    }
    if(!verification.verified|| !verification.registrationInfo){
        return res.status(400).json({error:'Registration could not be verified'})
    }
    const info= verification.registrationInfo;
    const credential=info.credential;

    const client =await db.connect();
    try{
        await client.query('BEGIN');
        await client.query(
            `INSERT INTO users (id,username,display_name) VALUES ($1,$2,$3)`,
            [flow.pending_user_id,flow.pending_username, flow.pending_display_name]
        );

        await client.query(
            `INSERT INTO passkeys
                (credential_id, user_id,webauthn_user_id,public_key,counter,transports,device_type,backed_up) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
                [
                    credential.id,
                    flow.pending_user_id,
                    flow.pending_webauthn_user_id,
                    Buffer.from(credential.publicKey),
                    credential.counter,
                    credential.transports ?? [],
                    info.credentialDeviceType,
                    info.credentialBackedUp,
                ]
        );

        await client.query(
            `UPDATE webauthn_challenges SET consumed_at= now() WHERE id=$1`,
            [flowId]
        );

        const sessionToken=randomBytes(32);
        const tokenHash= createHash('sha256').update(sessionToken).digest();
        const ttlMs=Number(process.env.SESSION_TTL_HOURS!)*3600_000;
        await client.query(
            `INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1,$2, $3)`,
            [tokenHash, flow.pending_user_id,new Date(Date.now()+ ttlMs)]
        );

        await client.query('COMMIT');

        res.cookie('session',sessionToken.toString('base64url'),{
            httpOnly:true,
            sameSite:'lax',
            secure: process.env.NODE_ENV==='production',
            maxAge:ttlMs,
            path:'/',
        });
        res.json({ok:true, username:flow.pending_username});
    }
    catch(err:any){
        await client.query('ROLLBACK');
        if (err?.code === '23505') {
      return res.status(409).json({ error: 'Username or credential already registered' });
    }
    console.log(err);
    return res.status(500).json({ error: 'Internal server error' });
    }finally{
        client.release();
    }
});

app.post('/auth/options',async (req,res)=>{
    const options=await generateAuthenticationOptions({
        rpID:process.env.RP_ID!,
        userVerification:'required',
    });


    const {rows}=await db.query(
        `INSERT INTO webauthn_challenges (ceremony,challenge, expires_at)
        VALUES ('authenticate',$1,$2)
        RETURNING id`,
        [options.challenge,new Date(Date.now()+5*60_000)]
    );

    res.json({flowId:rows[0].id,options});
})

app.post('/auth/verify', async (req,res)=>{
    const {flowId, response}=req.body??{};
    if(!flowId || !response?.id){
        return res.status(400).json({error:'flowId and response.id are required'});
    }

    // One dedicated connection for the whole transaction — same pattern
    // as /register/verify. pool.query('BEGIN') would risk splitting the
    // transaction across connections.
    const client = await db.connect();
    try{
        await client.query('BEGIN');

        // 1. Challenge must exist, be for login, and be live.
        const { rows: [ch] } = await client.query(
          `SELECT challenge FROM webauthn_challenges
           WHERE id = $1 AND ceremony = 'authenticate'
             AND consumed_at IS NULL AND expires_at > now()`,
          [flowId]
        );
        if(!ch){
            await client.query('ROLLBACK');
          return res.status(400).json({ error: 'bad or expired challenge' });
        }

        // 2. The credential must exist and not be revoked. This is the
        //    lookup that answers "whose key is trying to log in?"
        const { rows: [pk] } = await client.query(
          `SELECT credential_id, user_id, public_key, counter FROM passkeys
           WHERE credential_id = $1 AND revoked_at IS NULL`,
          [response.id]
        );
        if (!pk) {
          await client.query('ROLLBACK');
          return res.status(401).json({ error: 'unknown credential' });
        }

        // 3. Verify signature + counter.
        let verification;
        try{
            verification=await verifyAuthenticationResponse({
                response,
                expectedChallenge:ch.challenge,
                expectedOrigin:process.env.EXPECTED_ORIGIN!,
                expectedRPID:process.env.RP_ID!,
                credential:{
                    id: pk.credential_id,
                    publicKey:new Uint8Array(pk.public_key),
                    counter:Number(pk.counter),
                },
                requireUserVerification:true,
            });
        }catch{
            await client.query('ROLLBACK');
            return res.status(401).json({ error: 'authentication failed' });
        }
        if (!verification.verified) {
          await client.query('ROLLBACK');
          return res.status(401).json({ error: 'authentication failed' });
        }
        const newCounter=verification.authenticationInfo.newCounter;

        // 4. Save the new counter, stamp last use.
        await client.query(
          `UPDATE passkeys SET counter = $1, last_used_at = now()
           WHERE credential_id = $2`,
          [newCounter, pk.credential_id]
        );

        // 5. Consume the challenge so it can't be replayed.
        await client.query(
          `UPDATE webauthn_challenges SET consumed_at = now() WHERE id = $1`,
          [flowId]
        );

        // 6. Mint the session. Raw token in the cookie; only its hash stored.
        const raw = crypto.randomBytes(32).toString('base64url');
        await client.query(
          `INSERT INTO sessions (token_hash, user_id, expires_at)
           VALUES ($1, $2, now() + make_interval(secs => $3))`,
          [hashToken(raw), pk.user_id, Number(process.env.SESSION_TTL_HOURS!) * 3600]
        );

        await client.query('COMMIT');
        res.cookie('session',raw,{
            httpOnly: true,
          sameSite: 'lax',
          maxAge: SESSION_TTL_MS,
        });
        res.json({ok:true});
    }catch(e){
        await client.query('ROLLBACK');
        throw e;
    }finally{
        client.release();
    }
})

async function requireSession(req: any, res: any, next: any) {
  const raw = req.cookies?.session;
  if (!raw) return res.status(401).json({ error: 'not logged in' });
  const { rows: [s] } = await db.query(
    `SELECT user_id FROM sessions
     WHERE token_hash = $1 AND expires_at > now()`,
    [hashToken(raw)]
  );
  if (!s) return res.status(401).json({ error: 'session expired' });
  req.userId = s.user_id;
  next();
}

app.get('/me', requireSession, async (req: any, res) => {
  const { rows: [u] } = await db.query(
    `SELECT id, username, display_name FROM users WHERE id = $1`,
    [req.userId]
  );
  res.json(u);
});

app.post('/logout', requireSession, async (req: any, res) => {
  await db.query(`DELETE FROM sessions WHERE token_hash = $1`, [
    hashToken(req.cookies.session),
  ]);
  res.clearCookie('session');
  res.json({ ok: true });
});


app.listen(3000,()=>console.log('API on :3000'));
