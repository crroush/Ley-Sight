export async function decodePackagedResponse(
  response: Response,
): Promise<string> {
  const bytes = new Uint8Array(await response.arrayBuffer());
  const isGzip = bytes[0] === 0x1f && bytes[1] === 0x8b;
  if (!isGzip) return new TextDecoder().decode(bytes);
  if (typeof DecompressionStream === "undefined") {
    throw new Error("This browser cannot decompress packaged map resources.");
  }
  const stream = new Blob([bytes]).stream()
    .pipeThrough(new DecompressionStream("gzip"));
  return await new Response(stream).text();
}

/**
 * Loads the same gzip-compressed Natural Earth resources as ol_bridge.js.
 * Some development servers set Content-Encoding and Fetch decodes the body
 * automatically, while others return raw gzip bytes. Signature detection
 * supports both contracts and prevents accidental double decompression.
 */
export async function loadPackagedGeoJson(
  resourceName: "countries" | "lakes",
): Promise<object> {
  const response = await fetch(`/resources/${resourceName}.geojson.gz`);
  if (!response.ok) {
    throw new Error(
      `${resourceName}.geojson.gz returned HTTP ${response.status}.`,
    );
  }
  return JSON.parse(await decodePackagedResponse(response)) as object;
}
