import Image from "next/image";

export default function Home() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex min-h-screen w-full max-w-3xl flex-col items-center justify-between bg-white px-16 py-32 dark:bg-black sm:items-start">
        <Image className="dark:invert" src="/next.svg" alt="Next.js logo" width={100} height={20} priority />
        <div className="flex flex-col items-center gap-6 text-center sm:items-start sm:text-left">
          <h1 className="max-w-xs text-3xl font-semibold leading-10 tracking-tight text-black dark:text-zinc-50">
            To get started, edit the page.tsx file.
          </h1>
          <p className="max-w-md text-lg leading-8 text-zinc-600 dark:text-zinc-400">
            Looking for a starting point? Head over to{" "}
            <a href="https://example.com/templates" className="font-medium text-zinc-950 dark:text-zinc-50">
              Templates
            </a>
            .
          </p>
        </div>
        <a
          className="flex h-12 items-center justify-center rounded-full bg-foreground px-5 text-background hover:bg-[#383838] dark:hover:bg-[#ccc]"
          href="https://example.com/deploy"
          target="_blank"
          rel="noopener noreferrer"
        >
          Deploy Now
        </a>
      </main>
    </div>
  );
}
