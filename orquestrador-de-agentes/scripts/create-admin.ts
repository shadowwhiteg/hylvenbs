import { createInterface } from "node:readline/promises";
import { hashPassword } from "../src/lib/auth/password.ts";
import { prisma } from "../src/lib/db.ts";

async function main() {
  const count = await prisma.user.count();
  if (count > 0) {
    console.error(`Já existem ${count} usuário(s) cadastrado(s). create-admin só roda com o banco vazio.`);
    process.exitCode = 1;
    return;
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const email = (await rl.question("E-mail do admin: ")).trim().toLowerCase();
    const name = (await rl.question("Nome: ")).trim();
    const password = (await rl.question("Senha (mín. 8 caracteres): ")).trim();

    if (!email || !name || password.length < 8) {
      console.error("Dados inválidos — e-mail, nome e senha (mín. 8 caracteres) são obrigatórios.");
      process.exitCode = 1;
      return;
    }

    const user = await prisma.user.create({
      data: {
        email,
        name,
        passwordHash: hashPassword(password),
        role: "admin",
        mustChangePassword: false,
      },
    });
    console.log(`Admin criado: ${user.email} (${user.id})`);
  } finally {
    rl.close();
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
