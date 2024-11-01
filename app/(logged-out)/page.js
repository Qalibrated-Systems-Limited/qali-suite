import { Button } from "../../components/ui/button";
import { ComputerIcon } from "lucide-react";
import Link from "next/link";

export default function LandingPage() {
  return (
    <>
      <h1 className="flex gap-2 items-center">
        {" "}
        <ComputerIcon size={50} className="text-pink-500" />
        StockVault
      </h1>
      <p>The most compherensive and efficient store management system</p>
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
