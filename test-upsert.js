
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const result = await prisma.siteAudit.upsert({
    where: { projectId: 'test-project-id' },
    update: { domain: 'test.com' },
    create: { projectId: 'test-project-id', domain: 'test.com', auditMatrix: {}, actionPlan: [], brandInfo: {}, rawData: {}, existingPages: [], existingKeywords: [] }
  });
  console.log('Upsert result:', result);
}
main().catch(console.error).finally(() => prisma.$disconnect());

