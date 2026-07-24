import { MigrationInterface, QueryRunner } from "typeorm";

export class AddKnowledgeBaseNameUnique1784871996843 implements MigrationInterface {
    name = 'AddKnowledgeBaseNameUnique1784871996843'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX \`idx_name\` ON \`knowledge_base\``);
        await queryRunner.query(`CREATE UNIQUE INDEX \`uk_name\` ON \`knowledge_base\` (\`name\`)`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX \`uk_name\` ON \`knowledge_base\``);
        await queryRunner.query(`CREATE INDEX \`idx_name\` ON \`knowledge_base\` (\`name\`)`);
    }

}
