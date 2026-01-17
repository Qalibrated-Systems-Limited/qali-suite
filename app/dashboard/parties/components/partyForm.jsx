"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { createParty, updateParty } from "@/app/mongodb/actions/party-actions";
import { toast } from "sonner";
import { useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";

export default function PartyForm({ party = null }) {
  const router = useRouter();
  const isEdit = !!party;

  // Use different action based on mode
  const action = isEdit ? updateParty.bind(null, party._id) : createParty;
  const [state, formAction, isPending] = useActionState(action, {});

  // Handle success
  useEffect(() => {
    if (state.success) {
      toast.success(state.message);
      if (isEdit) {
        router.push(`/dashboard/parties/${party._id}`);
      } else {
        router.push("/dashboard/parties");
      }
    }
  }, [state.success, state.message, router, isEdit, party]);

  return (
    <form action={formAction} className="space-y-6">
      {/* General Error */}
      {state.errors?._form && (
        <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-sm">
          {state.errors._form[0]}
        </div>
      )}

      {/* SECTION 1: Basic Information */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Basic Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Party Type */}
          <div className="space-y-2">
            <Label htmlFor="type">
              Party Type <span className="text-destructive">*</span>
            </Label>
            <Select name="type" defaultValue={party?.type || ""}>
              <SelectTrigger>
                <SelectValue placeholder="Select type..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="customer">Customer</SelectItem>
                <SelectItem value="supplier">Supplier</SelectItem>
                <SelectItem value="employee">Employee</SelectItem>
                <SelectItem value="both">Both (Customer & Supplier)</SelectItem>
              </SelectContent>
            </Select>
            {state.errors?.type && (
              <p className="text-sm text-destructive">{state.errors.type[0]}</p>
            )}
          </div>

          {/* Name */}
          <div className="space-y-2">
            <Label htmlFor="name">
              Name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="name"
              name="name"
              defaultValue={party?.name || ""}
              placeholder="Full legal name"
              className="bg-background"
            />
            {state.errors?.name && (
              <p className="text-sm text-destructive">{state.errors.name[0]}</p>
            )}
          </div>

          {/* Display Name */}
          <div className="space-y-2">
            <Label htmlFor="displayName">Display Name</Label>
            <Input
              id="displayName"
              name="displayName"
              defaultValue={party?.displayName || ""}
              placeholder="Short name for invoices"
              className="bg-background"
            />
            <p className="text-xs text-muted-foreground">
              Optional: Short name (e.g., "KTDA" instead of "Kenya Tea
              Development Agency")
            </p>
          </div>
        </CardContent>
      </Card>

      {/* SECTION 2: Contact Information */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Contact Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Email */}
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                defaultValue={party?.email || ""}
                placeholder="email@example.com"
                className="bg-background"
              />
              {state.errors?.email && (
                <p className="text-sm text-destructive">
                  {state.errors.email[0]}
                </p>
              )}
            </div>

            {/* Phone */}
            <div className="space-y-2">
              <Label htmlFor="phone">Phone</Label>
              <Input
                id="phone"
                name="phone"
                type="tel"
                defaultValue={party?.phone || ""}
                placeholder="+254 700 000 000"
                className="bg-background"
              />
            </div>
          </div>

          {/* Tax PIN */}
          <div className="space-y-2">
            <Label htmlFor="taxPin">KRA Tax PIN</Label>
            <Input
              id="taxPin"
              name="taxPin"
              defaultValue={party?.taxPin || ""}
              placeholder="A000000000X"
              className="uppercase bg-background"
              maxLength={11}
            />
            {state.errors?.taxPin && (
              <p className="text-sm text-destructive">
                {state.errors.taxPin[0]}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Format: A000000000X (one letter, 9 digits, one letter)
            </p>
          </div>
        </CardContent>
      </Card>

      {/* SECTION 3: Employee Details */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            Employee Details (if applicable)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="employeeNumber">Employee Number</Label>
              <Input
                id="employeeNumber"
                name="employeeNumber"
                defaultValue={party?.employeeNumber || ""}
                placeholder="EMP001"
                className="bg-background"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="department">Department</Label>
              <Input
                id="department"
                name="department"
                defaultValue={party?.department || ""}
                placeholder="Finance"
                className="bg-background"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="designation">Designation</Label>
              <Input
                id="designation"
                name="designation"
                defaultValue={party?.designation || ""}
                placeholder="Accountant"
                className="bg-background"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* SECTION 4: Supplier/Contractor Details */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Supplier/Contractor Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex items-center space-x-2">
              <Checkbox
                id="isContractor"
                name="isContractor"
                defaultChecked={party?.isContractor || false}
              />
              <Label
                htmlFor="isContractor"
                className="font-normal cursor-pointer"
              >
                Is Contractor (requires WHT)
              </Label>
            </div>

            <div className="flex items-center space-x-2">
              <Checkbox
                id="whtApplicable"
                name="whtApplicable"
                defaultChecked={party?.whtApplicable || false}
              />
              <Label
                htmlFor="whtApplicable"
                className="font-normal cursor-pointer"
              >
                WHT Applicable
              </Label>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="whtRate">WHT Rate (%)</Label>
            <Select name="whtRate" defaultValue={String(party?.whtRate || 0)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">0% (No WHT)</SelectItem>
                <SelectItem value="5">5%</SelectItem>
                <SelectItem value="10">10%</SelectItem>
                <SelectItem value="15">15%</SelectItem>
                <SelectItem value="20">20%</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* SECTION 5: Customer Credit Terms */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            Credit Terms (for customers)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="creditLimit">Credit Limit (KES)</Label>
              <Input
                id="creditLimit"
                name="creditLimit"
                type="number"
                defaultValue={party?.creditTerms?.creditLimit || 0}
                min="0"
                step="0.01"
                className="bg-background"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="paymentTermsDays">Payment Terms (days)</Label>
              <Input
                id="paymentTermsDays"
                name="paymentTermsDays"
                type="number"
                defaultValue={party?.creditTerms?.paymentTermsDays || 30}
                min="0"
                className="bg-background"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* SECTION 6: Bank Details */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            Bank Details (for suppliers)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="bankName">Bank Name</Label>
              <Input
                id="bankName"
                name="bankName"
                defaultValue={party?.paymentDetails?.bankName || ""}
                placeholder="KCB Bank"
                className="bg-background"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="accountNumber">Account Number</Label>
              <Input
                id="accountNumber"
                name="accountNumber"
                defaultValue={party?.paymentDetails?.accountNumber || ""}
                placeholder="1234567890"
                className="bg-background"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* SECTION 7: Notes */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Additional Notes</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              name="notes"
              defaultValue={party?.notes || ""}
              rows={4}
              placeholder="Additional information..."
              className="bg-background resize-none"
            />
          </div>
        </CardContent>
      </Card>

      {/* Submit Buttons */}
      <div className="flex flex-col-reverse sm:flex-row items-center justify-end gap-3 pt-6 border-t">
        <Button
          type="button"
          variant="outline"
          onClick={() => router.back()}
          className="w-full sm:w-auto"
        >
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={isPending}
          className="w-full sm:w-auto bg-yellow-500 text-black hover:bg-yellow-600"
        >
          {isPending ? "Saving..." : isEdit ? "Update Party" : "Create Party"}
        </Button>
      </div>
    </form>
  );
}
