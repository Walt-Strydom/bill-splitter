-- ============================================================
--  Bill Splitter (ZAR) – PostgreSQL Schema
--  Version: 1.0.0
--  Compatible: PostgreSQL 13+
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── Enum Types ──────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE party_status AS ENUM ('active', 'closed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE guest_role AS ENUM ('host', 'guest');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE guest_status AS ENUM ('active', 'closed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── Users ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
    id             UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    google_sub     VARCHAR     UNIQUE,
    email          VARCHAR,
    name           VARCHAR,
    picture_url    VARCHAR,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Parties ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS parties (
    id                  UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
    party_code          VARCHAR(6)    UNIQUE NOT NULL,
    currency            VARCHAR(3)    NOT NULL DEFAULT 'ZAR',
    restaurant_name     VARCHAR,
    status              party_status  NOT NULL DEFAULT 'active',
    tip_percent         NUMERIC(5,2)  NOT NULL DEFAULT 0,
    created_by_user_id  UUID          REFERENCES users(id),
    created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ─── Guests ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS guests (
    id            UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
    party_id      UUID          NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
    user_id       UUID          REFERENCES users(id),
    display_name  VARCHAR       NOT NULL,
    role          guest_role    NOT NULL DEFAULT 'guest',
    join_token    VARCHAR       UNIQUE NOT NULL,
    status        guest_status  NOT NULL DEFAULT 'active',
    closed_at     TIMESTAMPTZ,
    created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ─── Items (sourced from receipt OCR only) ───────────────────
CREATE TABLE IF NOT EXISTS items (
    id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    party_id         UUID        NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
    name             VARCHAR     NOT NULL,
    unit_price_cents INTEGER     NOT NULL CHECK (unit_price_cents > 0),
    total_quantity   INTEGER     NOT NULL CHECK (total_quantity > 0),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Selections (guests claim item quantities) ───────────────
CREATE TABLE IF NOT EXISTS selections (
    id         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    party_id   UUID        NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
    guest_id   UUID        NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
    item_id    UUID        NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    quantity   INTEGER     NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(guest_id, item_id)
);

-- ─── Payments ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payments (
    id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    party_id         UUID        NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
    guest_id         UUID        NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
    amount_paid_cents INTEGER    NOT NULL CHECK (amount_paid_cents > 0),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Closures (immutable record per guest) ───────────────────
CREATE TABLE IF NOT EXISTS closures (
    id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    party_id        UUID        NOT NULL REFERENCES parties(id),
    guest_id        UUID        NOT NULL REFERENCES guests(id),
    subtotal_cents  INTEGER     NOT NULL,
    tip_cents       INTEGER     NOT NULL DEFAULT 0,
    total_cents     INTEGER     NOT NULL,
    paid_cents      INTEGER     NOT NULL,
    closed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(guest_id)
);

-- ─── Restaurants ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS restaurants (
    id   UUID    PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR UNIQUE NOT NULL
);

-- ─── User–Restaurant History ─────────────────────────────────
CREATE TABLE IF NOT EXISTS user_restaurant_history (
    id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    restaurant_id   UUID        NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    visit_count     INTEGER     NOT NULL DEFAULT 1,
    last_visit_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, restaurant_id)
);

-- ─── People Users Have Split Bills With ──────────────────────
CREATE TABLE IF NOT EXISTS user_shared_people (
    id                UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id           UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    other_user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    shared_party_count INTEGER    NOT NULL DEFAULT 1,
    last_shared_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, other_user_id),
    CHECK (user_id <> other_user_id)
);

-- ─── Party Validation View ────────────────────────────────────
--
--   Returns per-party:
--     subtotal_required   – sum of (unit_price_cents * total_quantity)
--     subtotal_claimed    – sum of all guest selections (in cents)
--     bucket_empty        – TRUE when every item is fully claimed
--     subtotal_match      – TRUE when subtotal_claimed >= subtotal_required
--     party_can_pay       – TRUE when both bucket_empty AND subtotal_match
--     remaining_value_cents – cents still unclaimed
CREATE OR REPLACE VIEW party_validation_view AS
SELECT
    p.id                                                                              AS party_id,
    p.party_code,
    p.status,
    p.tip_percent,
    p.restaurant_name,
    -- Total value of all items on the receipt
    COALESCE(ia.subtotal_required, 0)                                                 AS subtotal_required,
    -- Total value claimed by all guests
    COALESCE(sa.subtotal_claimed, 0)                                                  AS subtotal_claimed,
    -- TRUE only when every item has zero remaining quantity
    COALESCE(ia.bucket_empty, TRUE)                                                   AS bucket_empty,
    -- TRUE when every cent of the receipt is accounted for
    COALESCE(sa.subtotal_claimed, 0) >= COALESCE(ia.subtotal_required, 0)            AS subtotal_match,
    -- TRUE when both conditions above hold
    (
        COALESCE(ia.bucket_empty, TRUE)
        AND COALESCE(sa.subtotal_claimed, 0) >= COALESCE(ia.subtotal_required, 0)
    )                                                                                  AS party_can_pay,
    -- Cents still unclaimed
    GREATEST(0,
        COALESCE(ia.subtotal_required, 0) - COALESCE(sa.subtotal_claimed, 0)
    )                                                                                  AS remaining_value_cents
FROM parties p
LEFT JOIN (
    SELECT
        i.party_id,
        SUM(i.unit_price_cents * i.total_quantity)                                    AS subtotal_required,
        -- bucket_empty: no item has unclaimed quantity remaining
        NOT BOOL_OR(
            i.total_quantity > COALESCE(
                (SELECT SUM(s.quantity) FROM selections s WHERE s.item_id = i.id),
                0
            )
        )                                                                              AS bucket_empty
    FROM items i
    GROUP BY i.party_id
) ia ON ia.party_id = p.id
LEFT JOIN (
    SELECT
        s.party_id,
        SUM(s.quantity * i.unit_price_cents)                                          AS subtotal_claimed
    FROM   selections s
    JOIN   items i ON i.id = s.item_id
    GROUP  BY s.party_id
) sa ON sa.party_id = p.id;

-- ─── Unclaimed Items View ─────────────────────────────────────
CREATE OR REPLACE VIEW unclaimed_items_view AS
SELECT
    i.id            AS item_id,
    i.party_id,
    i.name,
    i.unit_price_cents,
    i.total_quantity,
    COALESCE(
        (SELECT SUM(s.quantity) FROM selections s WHERE s.item_id = i.id),
        0
    )                                                        AS claimed_quantity,
    i.total_quantity - COALESCE(
        (SELECT SUM(s.quantity) FROM selections s WHERE s.item_id = i.id),
        0
    )                                                        AS remaining_quantity,
    (i.total_quantity - COALESCE(
        (SELECT SUM(s.quantity) FROM selections s WHERE s.item_id = i.id),
        0
    )) * i.unit_price_cents                                  AS remaining_value_cents
FROM items i
WHERE i.total_quantity > COALESCE(
    (SELECT SUM(s.quantity) FROM selections s WHERE s.item_id = i.id),
    0
);

-- ─── Indexes ─────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_parties_code        ON parties(party_code);
CREATE INDEX IF NOT EXISTS idx_parties_status      ON parties(status);
CREATE INDEX IF NOT EXISTS idx_guests_party_id     ON guests(party_id);
CREATE INDEX IF NOT EXISTS idx_guests_join_token   ON guests(join_token);
CREATE INDEX IF NOT EXISTS idx_guests_user_id      ON guests(user_id);
CREATE INDEX IF NOT EXISTS idx_items_party_id      ON items(party_id);
CREATE INDEX IF NOT EXISTS idx_selections_guest_id ON selections(guest_id);
CREATE INDEX IF NOT EXISTS idx_selections_item_id  ON selections(item_id);
CREATE INDEX IF NOT EXISTS idx_selections_party_id ON selections(party_id);
CREATE INDEX IF NOT EXISTS idx_payments_guest_id   ON payments(guest_id);
CREATE INDEX IF NOT EXISTS idx_payments_party_id   ON payments(party_id);
CREATE INDEX IF NOT EXISTS idx_closures_party_id   ON closures(party_id);
CREATE INDEX IF NOT EXISTS idx_closures_guest_id   ON closures(guest_id);
CREATE INDEX IF NOT EXISTS idx_urh_user_id         ON user_restaurant_history(user_id);
CREATE INDEX IF NOT EXISTS idx_usp_user_id         ON user_shared_people(user_id);
