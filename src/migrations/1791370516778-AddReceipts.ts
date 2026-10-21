import { MigrationInterface, QueryRunner } from "typeorm";

export class AddReceipts1791370516778 implements MigrationInterface {
    name = 'AddReceipts1791370516778'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "receipts" ("id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL, "event_id" text NOT NULL, "order_id" bigint NOT NULL, "total" integer NOT NULL, "issued_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_24f0e73ac9fd9166da129f18f78" UNIQUE ("event_id"), CONSTRAINT "receipts_total_check" CHECK (total >= 0), CONSTRAINT "PK_5e8182d7c29e023da6e1ff33bfe" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "receipts" ADD CONSTRAINT "FK_9545ae8fc5f7714cd8a807dd937" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "receipts" DROP CONSTRAINT "FK_9545ae8fc5f7714cd8a807dd937"`);
        await queryRunner.query(`DROP TABLE "receipts"`);
    }

}
