// GET /profile: the Preference Profile (FR-6). No query parameters (plan D7); empty history gives empty lists.
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { PreferenceProfile } from '../schemas/profile.ts';
import type { ProfileService } from '../services/profile-service.ts';

export async function profileRoutes(app: FastifyInstance, service: ProfileService): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();
  r.get('/profile', { schema: { tags: ['profile'], response: { 200: PreferenceProfile } } }, () => service.get());
}
