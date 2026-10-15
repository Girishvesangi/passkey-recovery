# Recovery Protocol

## Purpose

Passkeys have no password and no reset email. If the owner loses
every authenticator, the account is gone — unless a recovery path
was set up in advance. This protocol provides recovery in layers,
modeled on what production services (Google, GitHub, Microsoft,
Apple) actually deploy:

  Layer 0 — prevention: multiple passkeys, at least one synced.
  Layer 1 — recovery codes: pre-issued, single-use, offline.
  Layer 2 — delayed email recovery: 72-hour wait, notify + veto.

Every layer ends the same way: the owner enrolls ONE new passkey,
and every old passkey and session is revoked. No layer ever
recovers or decrypts an old authenticator's private key.

Design principle (FIDO / NIST SP 800-63B): recovery IS
authentication. The account's real security is the strength of
its weakest recovery path, so every path here is held to the
same standard as login itself.

This is a learning prototype, not a production security product.

## Actors

- **Owner** — the account being recovered. Configures recovery
  while logged in; uses it when locked out.
- **Requester** — whoever starts a recovery. Treated as
  untrusted: starting a recovery proves nothing by itself.
  Safety comes from the code check, the delay, and the veto —
  not from restricting who can ask.
- **Service** — this server. Issues and verifies codes, runs
  the delay clock, sends notifications, enforces the veto, and
  issues the single-use enrollment grant. It stores only hashes
  of codes and tokens, never the values themselves.
- **Email channel** — the owner's pre-registered email address.
  Used for notifications, the veto link, and the Layer 2 grant
  link. It is a notification and delivery channel, never a
  login credential by itself.


## Layer 1 — Recovery codes

### Setup (while logged in)

- Requires a fresh passkey authentication (not just an old
  session) — generating codes is a high-value action.
- The service generates **10 codes**. Each code is random,
  shown grouped for readability (e.g. `XXXX-XXXX-XXXX`).
- Codes are shown **exactly once**. The UI requires the owner
  to confirm "I have saved these" before leaving the page.
  There is no way to view them again — only to regenerate.
- The service stores only a **hash** of each code
  (SHA-256), plus `used_at` per code. A database leak reveals
  no usable codes.

### Regeneration

- A logged-in owner with fresh authentication can generate a
  new set at any time. The new set **immediately invalidates
  every old code**, used or not. (Same rule as Google/GitHub:
  one live set per account.)

### Redemption (while locked out)

1. Requester enters account identifier + one recovery code.
2. Service checks the code's hash against the account's
   unused codes. Failure returns one generic error —
   it never reveals whether the account exists, whether codes
   are set up, or which part was wrong.
3. Attempts are rate-limited per account and per IP; repeated
   failures trigger a lockout window.
4. On success, the code is marked used **immediately**,
   before anything else happens — a code can never be spent
   twice, even if the rest of the flow is abandoned.
5. The service issues a single-use **enrollment grant**
   (15 minutes, bound to this redemption). The grant permits
   exactly one action: enroll one new passkey. It is NOT a
   session and grants no account access.
6. When the new passkey is enrolled: **all old passkeys are
   revoked, all sessions are deleted, and all remaining
   recovery codes are invalidated.** The grant is consumed.
7. The owner then logs in normally with the new passkey, and
   is prompted to generate a fresh set of codes.

### Honest limits

- A recovery code is a bearer secret: whoever presents it is
  treated as the owner. It can be phished or stolen from
  wherever the owner stored it. This is the accepted industry
  trade-off — the defense is that codes are offline, single-
  use, and rate-limited, not that they are unstealable.
- If the owner loses the codes AND every passkey, Layer 1 is
  gone. That is what Layer 2 exists for.

## Layer 2 — Delayed email recovery

For owners who lost every passkey AND their recovery codes.
This is the weakest-evidence path, so it is the slowest and
loudest — the same pattern Google (security holds), GitHub
(multi-day resets), and Microsoft (30-day restriction) use.

### Setup prerequisite

- The owner registers a **recovery email** while logged in,
  and verifies it (the service emails a confirmation link;
  the address counts only after it is clicked). No verified
  email on file = Layer 2 does not exist for that account.

### Flow

1. Requester enters the account identifier and asks for
   email recovery. The response is **always** the same
   generic message ("If this account has a verified recovery
   email, a recovery has been started") — whether or not the
   account or email exists. No enumeration.
2. A recovery request is created in `waiting`, with
   `execute_after = now + 72 hours` (2 minutes in local demo
   mode, `RECOVERY_DELAY_SECONDS`). The grant link is emailed
   to the recovery address but is **inert until the delay
   passes**.
3. **Notifications fire immediately**: to the recovery email,
   and shown in-app on any live session. "A recovery was
   started. Wasn't you? Cancel it." Silence is what an
   attacker wants; this flow is loud on purpose.
4. **Veto:** the owner can kill the request at any point
   before completion — from a live session, or via the veto
   link in the notification email. A veto is permanent for
   that request and is itself notified.
5. After the delay, the grant link activates: it carries a
   single-use token (hash stored server-side, 24-hour expiry
   once active) that opens the same restricted
   enroll-one-new-passkey flow as Layer 1.
6. On enrollment: all old passkeys revoked, all sessions
   deleted, all recovery codes invalidated, request marked
   completed. Owner logs in with the new passkey and must
   re-do recovery setup (codes + email) from scratch.
7. If nobody uses the activated grant before it expires,
   the request expires. Nothing about the account changes —
   the old passkeys were never touched.

### State machine (Layer 2 requests)

    waiting --delay ends--> ready --grant used--> completed
       |                       |
       +--- veto ---> vetoed  +--- grant expires ---> expired

- One active request per account at a time; starting a new
  one cancels any existing `waiting`/`ready` request.
- Every transition happens in ONE service function inside
  ONE database transaction. Routes never update `status`
  directly.
- The veto check and the grant-use check are the same
  transaction boundary: a veto that lands first always wins
  over a grant used a millisecond later.

### Honest limits

- Layer 2's security is exactly the security of the owner's
  inbox, plus time. An attacker who controls the email AND
  stays unnoticed for 72 hours wins. The delay + loud
  notification + veto are the entire defense — which is why
  this layer is optional, clearly labeled, and never instant.
- An attacker can spam recovery requests to annoy the owner.
  Rate limits and the one-active-request rule cap the damage
  at noise; they cannot make it zero.


## Data model

New migration (`002_recovery.sql`):

```sql
-- Recovery email lives on the user; it only counts once verified.
ALTER TABLE users
  ADD COLUMN recovery_email text,
  ADD COLUMN recovery_email_verified_at timestamptz;

-- Layer 1: one row per code. Only the hash is ever stored.
CREATE TABLE recovery_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash bytea NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX recovery_codes_live
  ON recovery_codes(user_id) WHERE used_at IS NULL;

-- Layer 2: one row per email-recovery request.
CREATE TABLE recovery_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN
    ('waiting', 'ready', 'vetoed', 'completed', 'expired')),
  execute_after timestamptz NOT NULL,
  grant_expires_at timestamptz,
  vetoed_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- At most one live request per account, enforced by the DB,
-- not by hoping the code checks first.
CREATE UNIQUE INDEX one_active_recovery_request_per_user
  ON recovery_requests(user_id)
  WHERE status IN ('waiting', 'ready');

-- Shared by both layers: the enroll-one-passkey grant.
CREATE TABLE recovery_grants (
  token_hash bytea PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source text NOT NULL CHECK (source IN ('code', 'email')),
  request_id uuid REFERENCES recovery_requests(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

