import Link from "next/link";
import { FileQuestion } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-[70dvh] items-center justify-center px-4">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
          <FileQuestion className="h-6 w-6 text-muted-foreground" />
        </div>
        <h1 className="text-xl font-semibold">Page not found</h1>
        <p className="mt-2 text-sm text-muted-foreground">The page you&apos;re looking for doesn&apos;t exist, or you don&apos;t have access to it in this workspace.</p>
        <Button asChild className="mt-6">
          <Link href="/">Go to my dashboard</Link>
        </Button>
      </div>
    </div>
  );
}
