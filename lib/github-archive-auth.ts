const issuer = "https://token.actions.githubusercontent.com";
const audience = "https://clima.antaisolar.com.br/api/weather/archive";
const workflow = "marcelo-pes/clima/.github/workflows/ecowitt-archive.yml@refs/heads/main";

function bytes(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")), (character) => character.charCodeAt(0));
}

export async function authorizedArchive(request: Request) {
  const reject = (reason: string) => { console.warn("Autenticação da coleta recusada:", reason); return false; };
  const token = request.headers.get("authorization")?.match(/^Bearer ([-\w.]+)$/)?.[1];
  if (!token) return reject("cabeçalho");
  const segments = token.split(".");
  if (segments.length !== 3) return reject("formato");
  try {
    const header = JSON.parse(new TextDecoder().decode(bytes(segments[0]))) as { alg?: string; kid?: string };
    const claims = JSON.parse(new TextDecoder().decode(bytes(segments[1]))) as Record<string, unknown>;
    const now = Math.floor(Date.now() / 1000);
    if (header.alg !== "RS256" || !header.kid) return reject("algoritmo");
    if (claims.iss !== issuer) return reject("emissor");
    if (claims.aud !== audience) return reject("audiência");
    if (claims.repository !== "marcelo-pes/clima") return reject("repositório");
    if (claims.ref !== "refs/heads/main") return reject("branch");
    if (claims.sub !== "repo:marcelo-pes/clima:ref:refs/heads/main") return reject("sujeito");
    if (claims.workflow_ref !== workflow) return reject("workflow");
    if (typeof claims.exp !== "number" || claims.exp < now || typeof claims.iat !== "number" || claims.iat > now + 60) return reject("validade");
    const configuration = await fetch(`${issuer}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(5000) });
    if (!configuration.ok) return reject("descoberta OIDC");
    const discovery = await configuration.json() as { jwks_uri?: string };
    if (discovery.jwks_uri !== `${issuer}/.well-known/jwks`) return reject("endereço JWKS");
    const response = await fetch(discovery.jwks_uri, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return reject("download JWKS");
    const jwks = await response.json() as { keys?: (JsonWebKey & { kid?: string })[] };
    const jwk = jwks.keys?.find((key) => key.kid === header.kid && key.kty === "RSA" && key.use === "sig");
    if (!jwk) return reject("chave de assinatura");
    const publicKey = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    if (!await crypto.subtle.verify("RSASSA-PKCS1-v1_5", publicKey, bytes(segments[2]), new TextEncoder().encode(`${segments[0]}.${segments[1]}`))) return reject("assinatura");
    return true;
  } catch { return reject("erro de verificação"); }
}
