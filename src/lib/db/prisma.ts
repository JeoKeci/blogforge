import { PrismaClient } from '@prisma/client';
import { fieldEncryptionExtension } from 'prisma-field-encryption';

const basePrisma = new PrismaClient().$extends(
  fieldEncryptionExtension()
);

type ExtendedPrismaClient = typeof basePrisma;

const globalForPrisma = globalThis as unknown as {
  prisma: ExtendedPrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? basePrisma;

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}


