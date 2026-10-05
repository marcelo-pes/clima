export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'cloudflare:workers') return { url: new URL('./cloudflare-env.mjs', import.meta.url).href, shortCircuit: true };
  return nextResolve(specifier, context);
}
