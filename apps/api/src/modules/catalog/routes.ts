import type { FastifyInstance } from "fastify";

/**
 * Catalog module — categories, vendors, products, stock.
 * M1 scope (roadmap.md) — not built yet. See api-contracts.md §Catalog for
 * the full planned endpoint list. This stub exists so the module boundary
 * from architecture.md §2 is real in the running app from day one, and so
 * every client can be pointed at a live (if empty) route during M0.
 */
export async function catalogRoutes(app: FastifyInstance) {
  app.get("/categories", async (_req, reply) => {
    const categories = await app.prisma.category.findMany({ where: { isActive: true } });
    return reply.send({ categories });
  });
}
