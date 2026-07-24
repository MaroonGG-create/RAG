import { MigrationInterface, QueryRunner } from "typeorm";

export class InitSchema1784800736682 implements MigrationInterface {
    name = 'InitSchema1784800736682'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE \`document_chunk\` (\`id\` int UNSIGNED NOT NULL AUTO_INCREMENT, \`document_id\` int UNSIGNED NOT NULL, \`kb_id\` int UNSIGNED NOT NULL, \`chunk_index\` int UNSIGNED NOT NULL, \`content\` text NOT NULL, \`char_count\` int UNSIGNED NOT NULL, \`page_no\` int UNSIGNED NULL, \`qdrant_point_id\` char(36) NOT NULL, \`created_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updated_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), INDEX \`idx_kb\` (\`kb_id\`), UNIQUE INDEX \`uk_qdrant_point\` (\`qdrant_point_id\`), UNIQUE INDEX \`uk_doc_index\` (\`document_id\`, \`chunk_index\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
        await queryRunner.query(`CREATE TABLE \`document\` (\`id\` int UNSIGNED NOT NULL AUTO_INCREMENT, \`kb_id\` int UNSIGNED NOT NULL, \`file_name\` varchar(255) NOT NULL, \`file_ext\` varchar(10) NOT NULL COMMENT '文件格式由应用层校验，仅允许 pdf、md、txt', \`file_size\` bigint UNSIGNED NOT NULL, \`file_hash\` char(64) NOT NULL, \`storage_path\` varchar(500) NOT NULL, \`status\` enum ('pending', 'parsing', 'chunking', 'embedding', 'completed', 'failed') NOT NULL DEFAULT 'pending', \`error_message\` text NULL, \`chunk_count\` int UNSIGNED NOT NULL DEFAULT '0', \`created_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updated_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), INDEX \`idx_kb_status\` (\`kb_id\`, \`status\`), UNIQUE INDEX \`uk_kb_hash\` (\`kb_id\`, \`file_hash\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
        await queryRunner.query(`CREATE TABLE \`knowledge_base\` (\`id\` int UNSIGNED NOT NULL AUTO_INCREMENT, \`name\` varchar(100) NOT NULL, \`description\` varchar(500) NULL, \`document_count\` int UNSIGNED NOT NULL DEFAULT '0', \`created_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updated_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), INDEX \`idx_name\` (\`name\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
        await queryRunner.query(`CREATE TABLE \`message_reference\` (\`id\` int UNSIGNED NOT NULL AUTO_INCREMENT, \`message_id\` int UNSIGNED NOT NULL, \`document_id\` int UNSIGNED NULL, \`chunk_id\` int UNSIGNED NULL, \`document_name\` varchar(255) NOT NULL, \`chunk_index\` int UNSIGNED NOT NULL, \`page_no\` int UNSIGNED NULL, \`score\` decimal(5,4) NOT NULL, \`content_snapshot\` text NOT NULL, \`created_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updated_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), INDEX \`idx_msg\` (\`message_id\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
        await queryRunner.query(`CREATE TABLE \`message\` (\`id\` int UNSIGNED NOT NULL AUTO_INCREMENT, \`conversation_id\` int UNSIGNED NOT NULL, \`role\` enum ('user', 'assistant') NOT NULL, \`content\` text NOT NULL, \`status\` enum ('completed', 'failed') NOT NULL DEFAULT 'completed', \`error_message\` text NULL, \`created_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updated_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), INDEX \`idx_conv\` (\`conversation_id\`, \`id\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
        await queryRunner.query(`CREATE TABLE \`conversation\` (\`id\` int UNSIGNED NOT NULL AUTO_INCREMENT, \`kb_id\` int UNSIGNED NOT NULL, \`title\` varchar(200) NOT NULL, \`created_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updated_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), INDEX \`idx_kb\` (\`kb_id\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
        await queryRunner.query(`ALTER TABLE \`document_chunk\` ADD CONSTRAINT \`FK_13fe21b6cbdda6d223de93c1b4b\` FOREIGN KEY (\`document_id\`) REFERENCES \`document\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`document\` ADD CONSTRAINT \`FK_de194591c1b6476246598f17347\` FOREIGN KEY (\`kb_id\`) REFERENCES \`knowledge_base\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`message_reference\` ADD CONSTRAINT \`FK_13ab388ba9004222977d552f832\` FOREIGN KEY (\`message_id\`) REFERENCES \`message\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`message\` ADD CONSTRAINT \`FK_7fe3e887d78498d9c9813375ce2\` FOREIGN KEY (\`conversation_id\`) REFERENCES \`conversation\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`conversation\` ADD CONSTRAINT \`FK_6c46eb6af21906b5de097dad0db\` FOREIGN KEY (\`kb_id\`) REFERENCES \`knowledge_base\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`conversation\` DROP FOREIGN KEY \`FK_6c46eb6af21906b5de097dad0db\``);
        await queryRunner.query(`ALTER TABLE \`message\` DROP FOREIGN KEY \`FK_7fe3e887d78498d9c9813375ce2\``);
        await queryRunner.query(`ALTER TABLE \`message_reference\` DROP FOREIGN KEY \`FK_13ab388ba9004222977d552f832\``);
        await queryRunner.query(`ALTER TABLE \`document\` DROP FOREIGN KEY \`FK_de194591c1b6476246598f17347\``);
        await queryRunner.query(`ALTER TABLE \`document_chunk\` DROP FOREIGN KEY \`FK_13fe21b6cbdda6d223de93c1b4b\``);
        await queryRunner.query(`DROP INDEX \`idx_kb\` ON \`conversation\``);
        await queryRunner.query(`DROP TABLE \`conversation\``);
        await queryRunner.query(`DROP INDEX \`idx_conv\` ON \`message\``);
        await queryRunner.query(`DROP TABLE \`message\``);
        await queryRunner.query(`DROP INDEX \`idx_msg\` ON \`message_reference\``);
        await queryRunner.query(`DROP TABLE \`message_reference\``);
        await queryRunner.query(`DROP INDEX \`idx_name\` ON \`knowledge_base\``);
        await queryRunner.query(`DROP TABLE \`knowledge_base\``);
        await queryRunner.query(`DROP INDEX \`uk_kb_hash\` ON \`document\``);
        await queryRunner.query(`DROP INDEX \`idx_kb_status\` ON \`document\``);
        await queryRunner.query(`DROP TABLE \`document\``);
        await queryRunner.query(`DROP INDEX \`uk_doc_index\` ON \`document_chunk\``);
        await queryRunner.query(`DROP INDEX \`uk_qdrant_point\` ON \`document_chunk\``);
        await queryRunner.query(`DROP INDEX \`idx_kb\` ON \`document_chunk\``);
        await queryRunner.query(`DROP TABLE \`document_chunk\``);
    }

}
