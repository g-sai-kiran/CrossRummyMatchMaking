/**
 * Cloudflare Secrets Store bindings are async objects with get(), while
 * per-Worker secrets and local .dev.vars are plain strings.
 *
 * Support both without ever logging secret values.
 */
export interface SecretStoreBinding {
  get(): Promise<string>;
}

export type SecretBinding = string | SecretStoreBinding;

export async function readSecret(
  binding: SecretBinding | undefined,
  bindingName: string
): Promise<string> {
  let value: unknown;

  if (typeof binding === "string") {
    value = binding;
  } else if (
    binding !== null &&
    binding !== undefined &&
    typeof binding.get === "function"
  ) {
    try {
      value = await binding.get();
    } catch {
      throw new Error(
        `Failed to read Cloudflare Secrets Store binding ${bindingName}`
      );
    }
  } else {
    throw new Error(
      `Missing or invalid Cloudflare secret binding ${bindingName}`
    );
  }

  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Cloudflare secret binding ${bindingName} is empty`);
  }

  return value.trim();
}
