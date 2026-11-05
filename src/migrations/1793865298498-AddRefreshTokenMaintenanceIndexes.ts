import { MigrationInterface, QueryRunner } from "typeorm";

export class AddRefreshTokenMaintenanceIndexes1793865298498 implements MigrationInterface {
    name = 'AddRefreshTokenMaintenanceIndexes1793865298498'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE INDEX "refresh_tokens_revoked_at_idx" ON "refresh_tokens"  ("revoked_at") WHERE "revoked_at" IS NOT NULL`);
        await queryRunner.query(`CREATE INDEX "refresh_tokens_expires_at_idx" ON "refresh_tokens"  ("expires_at") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."refresh_tokens_expires_at_idx"`);
        await queryRunner.query(`DROP INDEX "public"."refresh_tokens_revoked_at_idx"`);
    }

}
