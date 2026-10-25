import type { FastifyInstance } from "fastify";
import { requireAuth } from "../../lib/auth-guard.js";
import { createFavoritesService, FavoriteProductNotFoundError, FollowVendorNotFoundError } from "./service.js";

/** Saved products (the heart on a card) and followed shops. Signed-in customers only — a guest has no server-side identity to hang either on. */
export async function favoritesRoutes(app: FastifyInstance) {
  const favorites = createFavoritesService(app.prisma);
  const auth = { preHandler: requireAuth(["customer"]) };

  async function customerId(userId: string) {
    return (await app.prisma.customerProfile.findUniqueOrThrow({ where: { userId } })).id;
  }

  app.get("/customer/favorites", auth, async (req, reply) => {
    return reply.send({ products: await favorites.list(await customerId(req.authUser!.sub)) });
  });

  app.put("/customer/favorites/:productId", auth, async (req, reply) => {
    const { productId } = req.params as { productId: string };
    try {
      await favorites.add(await customerId(req.authUser!.sub), productId);
      return reply.code(204).send();
    } catch (err) {
      if (err instanceof FavoriteProductNotFoundError) {
        return reply.code(404).send({ error: { code: "PRODUCT_NOT_FOUND", message: err.message } });
      }
      throw err;
    }
  });

  app.delete("/customer/favorites/:productId", auth, async (req, reply) => {
    const { productId } = req.params as { productId: string };
    await favorites.remove(await customerId(req.authUser!.sub), productId);
    return reply.code(204).send();
  });

  app.get("/customer/follows", auth, async (req, reply) => {
    return reply.send({ vendorIds: await favorites.followedVendorIds(await customerId(req.authUser!.sub)) });
  });

  app.put("/customer/follows/:vendorId", auth, async (req, reply) => {
    const { vendorId } = req.params as { vendorId: string };
    try {
      await favorites.followVendor(await customerId(req.authUser!.sub), vendorId);
      return reply.code(204).send();
    } catch (err) {
      if (err instanceof FollowVendorNotFoundError) {
        return reply.code(404).send({ error: { code: "VENDOR_NOT_FOUND", message: err.message } });
      }
      throw err;
    }
  });

  app.delete("/customer/follows/:vendorId", auth, async (req, reply) => {
    const { vendorId } = req.params as { vendorId: string };
    await favorites.unfollowVendor(await customerId(req.authUser!.sub), vendorId);
    return reply.code(204).send();
  });
}
