import {
  Tabs,
  TabsContent,
  TabsTrigger,
  TabsList,
} from "../../components/ui/tabs";
import WeeklySummary from "../dashboard/components/weeklySummary";
import AnnualSummary from "./annualSummary";
async function Page() {
  return (
    <Tabs defaultValue="today">
      <TabsList className="mb-4">
        <TabsTrigger value="today"> This Week Summary</TabsTrigger>
        <TabsTrigger value="systems">General summary</TabsTrigger>
      </TabsList>
      <TabsContent value="today">
        <WeeklySummary />
      </TabsContent>
      <TabsContent value="systems">
        <AnnualSummary />
      </TabsContent>
    </Tabs>
  );
}

export default Page;
