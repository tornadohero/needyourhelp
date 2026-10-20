-- Admin console credentials (T028 gap G1).
--
-- Username/password login for the admin web. Additive only: no existing table or
-- row is changed, so the migration is safe to apply to a running database.

CREATE TABLE "console_credentials" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "username" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "failed_attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMP(3),
    "last_used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "console_credentials_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "console_credentials_username_key" ON "console_credentials"("username");
CREATE INDEX "console_credentials_user_id_idx" ON "console_credentials"("user_id");

ALTER TABLE "console_credentials"
    ADD CONSTRAINT "console_credentials_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
