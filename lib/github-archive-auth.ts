const issuer = "https://token.actions.githubusercontent.com";
const audience = "https://clima.antaisolar.com.br/api/weather/archive";
const workflow = "marcelo-pes/clima/.github/workflows/ecowitt-archive.yml@refs/heads/main";

function bytes(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")), (character) => character.charCodeAt(0));
}

export async function authorizedArchive(request: Request) {
  const token = request.headers.get("authorization")?.match(/^Bearer ([-\w.]+)$/)?.[1];
  if (!token) return false;
  const segments = token.split(".");
  if (segments.length !== 3) return false;
  try {
    const header = JSON.parse(new TextDecoder().decode(bytes(segments[0]))) as { alg?: string; kid?: string };
    const claims = JSON.parse(new TextDecoder().decode(bytes(segments[1]))) as Record<string, unknown>;
    const now = Math.floor(Date.now() / 1000);
    if (header.alg !== "RS256" || !header.kid || claims.iss !== issuer || claims.aud !== audience ||
      claims.repository !== "marcelo-pes/clima" || claims.ref !== "refs/heads/main" ||
      claims.sub !== "repo:marcelo-pes/clima:ref:refs/heads/main" || claims.workflow_ref !== workflow ||
      typeof claims.exp !== "number" || claims.exp < now || typeof claims.iat !== "number" || claims.iat > now + 60) return false;
    const configuration = await fetch(`${issuer}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(5000) });
    if (!configuration.ok) return false;
    const discovery = await configuration.json() as { jwks_uri?: string };
    if (discovery.jwks_uri !== `${issuer}/.well-known/jwks`) return false;
    const response = await fetch(discovery.jwks_uri, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return false;
    const jwks = await response.json() as { keys?: (JsonWebKey & { kid?: string })[] };
    const jwk = jwks.keys?.find((key) => key.kid === header.kid && key.kty === "RSA" && key.use === "sig");
    if (!jwk) return false;
    const publicKey = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    return await crypto.subtle.verify("RSASSA-PKCS1-v1_5", publicKey, bytes(segments[2]), new TextEncoder().encode(`${segments[0]}.${segments[1]}`));
  } catch { return false; }
}
