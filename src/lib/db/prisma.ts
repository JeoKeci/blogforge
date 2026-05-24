import { PrismaClient } from '@prisma/client';
import { fieldEncryptionExtension } from 'prisma-field-encryption';

const globalForPrisma = globalThis as unknown as {
  prisma: any;
};

// Set up Prisma Client with transparent field encryption extension
export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient().$extends(
    fieldEncryptionExtension()
  );

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}


