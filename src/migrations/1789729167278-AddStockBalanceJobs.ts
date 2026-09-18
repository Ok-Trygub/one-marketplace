import { MigrationInterface, QueryRunner } from "typeorm";

export class AddStockBalanceJobs1789729167278 implements MigrationInterface {
    name = 'AddStockBalanceJobs1789729167278'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "jobs" ("id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL, "type" text NOT NULL, "payload" jsonb NOT NULL, "status" text NOT NULL DEFAULT 'pending', "processed" integer NOT NULL DEFAULT '0', "worker" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "processed_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "jobs_processed_check" CHECK (processed >= 0), CONSTRAINT "jobs_status_check" CHECK (status IN ('pending', 'done')), CONSTRAINT "PK_cf0a6c42b72fcc7f7c237def345" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "jobs_pending_id_idx" ON "jobs"  ("id") WHERE status = 'pending'`);
        await queryRunner.query(`ALTER TABLE "products" ADD "stock" integer NOT NULL DEFAULT '0'`);
        await queryRunner.query(`ALTER TABLE "users" ADD "balance" integer NOT NULL DEFAULT '0'`);
        await queryRunner.query(`ALTER TABLE "products" ADD CONSTRAINT "products_stock_check" CHECK (stock >= 0)`);
        await queryRunner.query(`ALTER TABLE "users" ADD CONSTRAINT "users_balance_check" CHECK (balance >= 0)`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT "users_balance_check"`);
        await queryRunner.query(`ALTER TABLE "products" DROP CONSTRAINT "products_stock_check"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "balance"`);
        await queryRunner.query(`ALTER TABLE "products" DROP COLUMN "stock"`);
        await queryRunner.query(`DROP INDEX "public"."jobs_pending_id_idx"`);
        await queryRunner.query(`DROP TABLE "jobs"`);
    }

}
