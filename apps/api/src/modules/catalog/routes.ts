import type { FastifyInstance } from "fastify";
import {
  vendorApplicationSchema,
  vendorUpdateSchema,
  vendorSearchQuerySchema,
  productCreateSchema,
  productUpdateSchema,
} from "@closebuy/types";
import { requireAuth } from "../../lib/auth-guard.js";
import {
  createCatalogService,
  VendorAlreadyExistsError,
  OutsideServiceAreaError,
  VendorNotFoundError,
  ProductNotFoundError,
} from "./service.js";

/**
 * Catalog module — categories, vendors, products, stock (US-C-02/03,
 * US-V-01/02/03). M1 (roadmap.md). Stock decrement under concurrent
 * orders (US-V-04, data-model.md §6 invariant 4) belongs to the Order
 * module once checkout exists — nothing here touches `stock` yet.
 */
export async function catalogRoutes(app: FastifyInstance) {
  const catalog = createCatalogService(app.prisma);

  app.get("/categories", async (_req, reply) => {
    return reply.send({ categories: await catalog.listCategories() });
  });

  app.get("/vendors", async (req, reply) => {
    const query = vendorSearchQuerySchema.parse(req.query);
    const { vendors, nextCursor } = await catalog.searchVendors(query);
    return reply.send({ vendors, nextCursor });
  });

  app.get("/vendors/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      return reply.send({ vendor: await catalog.getVendor(id) });
    } catch (err) {
      if (err instanceof VendorNotFoundError) {
        return reply.code(404).send({ error: { code: "VENDOR_NOT_FOUND", message: err.message } });
      }
      throw err;
    }
  });

  app.get("/vendors/:id/products", async (req, reply) => {
    const { id } = req.params as { id: string };
    return reply.send({ products: await catalog.getVendorProducts(id) });
  });

  app.post("/vendors", { preHandler: requireAuth(["vendor"]) }, async (req, reply) => {
    const body = vendorApplicationSchema.parse(req.body);
    try {
      const vendor = await catalog.submitApplication(req.authUser!.sub, body);
      return reply.code(201).send({ vendor });
    } catch (err) {
      if (err instanceof VendorAlreadyExistsError) {
        return reply.code(409).send({ error: { code: "VENDOR_EXISTS", message: err.message } });
      }
      if (err instanceof OutsideServiceAreaError) {
        return reply.code(422).send({ error: { code: "OUTSIDE_SERVICE_AREA", message: err.message } });
      }
      throw err;
    }
  });

  app.get("/vendors/me", { preHandler: requireAuth(["vendor"]) }, async (req, reply) => {
    try {
      return reply.send({ vendor: await catalog.getOwnVendorProfile(req.authUser!.sub) });
    } catch (err) {
      if (err instanceof VendorNotFoundError) {
        return reply.code(404).send({ error: { code: "VENDOR_NOT_FOUND", message: err.message } });
      }
      throw err;
    }
  });

  app.patch("/vendors/me", { preHandler: requireAuth(["vendor"]) }, async (req, reply) => {
    const body = vendorUpdateSchema.parse(req.body);
    try {
      const vendor = await catalog.updateOwnVendorProfile(req.authUser!.sub, body);
      return reply.send({ vendor });
    } catch (err) {
      if (err instanceof VendorNotFoundError) {
        return reply.code(404).send({ error: { code: "VENDOR_NOT_FOUND", message: err.message } });
      }
      throw err;
    }
  });

  app.post("/vendors/me/products", { preHandler: requireAuth(["vendor"]) }, async (req, reply) => {
    const body = productCreateSchema.parse(req.body);
    try {
      const product = await catalog.createProduct(req.authUser!.sub, body);
      return reply.code(201).send({ product });
    } catch (err) {
      if (err instanceof VendorNotFoundError) {
        return reply.code(404).send({ error: { code: "VENDOR_NOT_FOUND", message: err.message } });
      }
      throw err;
    }
  });

  app.patch("/vendors/me/products/:id", { preHandler: requireAuth(["vendor"]) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = productUpdateSchema.parse(req.body);
    try {
      const product = await catalog.updateProduct(req.authUser!.sub, id, body);
      return reply.send({ product });
    } catch (err) {
      if (err instanceof VendorNotFoundError || err instanceof ProductNotFoundError) {
        return reply.code(404).send({ error: { code: "NOT_FOUND", message: err.message } });
      }
      throw err;
    }
  });

  app.delete("/vendors/me/products/:id", { preHandler: requireAuth(["vendor"]) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      await catalog.deactivateProduct(req.authUser!.sub, id);
      return reply.code(204).send();
    } catch (err) {
      if (err instanceof VendorNotFoundError || err instanceof ProductNotFoundError) {
        return reply.code(404).send({ error: { code: "NOT_FOUND", message: err.message } });
      }
      throw err;
    }
  });
}
