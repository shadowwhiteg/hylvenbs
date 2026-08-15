import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    /**
     * Vários testes gravam no MESMO SQLite (`prisma/dev.db`). Em paralelo eles
     * disputam o arquivo e falham por "Socket timeout" — um arquivo diferente a
     * cada execução, o que faz a suíte parecer instável sem motivo. Serial custa
     * alguns segundos e devolve resultado determinístico.
     */
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
