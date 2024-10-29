import { Button } from "../../components/ui/button";
import { ScaleIcon } from "lucide-react";
import Link from "next/link";

export default function LandingPage() {
  return (
    <>
      <h1 className="flex gap-2 items-center">
        {" "}
        <ScaleIcon size={50} className="text-pink-500" />
        Kilo sahihi
      </h1>
      <p>The most compherensive and efficient weighing system</p>
      <div className="flex  gap-2 items-center">
        <Button asChild>
          <Link href={"/login"}>Login</Link>
        </Button>
        <small>Or</small>
        <Button variant="outline">Sign up</Button>
      </div>
    </>
  );
}
