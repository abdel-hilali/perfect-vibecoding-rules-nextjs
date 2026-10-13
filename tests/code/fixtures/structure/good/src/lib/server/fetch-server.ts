import "server-only";

export async function fetchServer(path: string) {
  const response = await fetch(`${process.env.BACKEND_API_URL}${path}`, { cache: "no-store" });
  return response.json();
}
