import { prisma } from "@/lib/db";

async function main() {
  const products = await prisma.product.count();
  const run = await prisma.syncRun.findFirst({ orderBy: { startedAt: "desc" } });
  console.log(JSON.stringify({ products, run }, null, 2));
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
