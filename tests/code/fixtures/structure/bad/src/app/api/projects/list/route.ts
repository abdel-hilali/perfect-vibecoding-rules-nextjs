import { cookies } from "next/headers";

export async function GET() {
  const jar = await cookies();
  return fetch(`${process.env.BACKEND_API_URL}/projects`, { headers: { cookie: jar.toString() } });
}
