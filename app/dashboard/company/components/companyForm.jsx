"use client";

import { useActionState, useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createCompany, updateCompany } from "@/app/mongodb/actions/company-actions";
import { toast } from "sonner";
import { useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Building2, Mail, MapPin, CreditCard, Smartphone, Upload, X, Loader2 } from "lucide-react";

export default function CompanyForm({ company = null, isSuperAdmin = false }) {
  const router = useRouter();
  const isEdit = !!company;

  // Don't use .bind() - the companyId is passed via hidden input field
  const action = isEdit ? updateCompany : createCompany;
  const [state, formAction, isPending] = useActionState(action, {});

  // Helper to get field value - prioritize submitted values on error, then company data
  const v = (field, fallback = "") => state.values?.[field] ?? fallback;

  // Logo upload state
  const [logoUrl, setLogoUrl] = useState(company?.logo || "");
  const [logoUploading, setLogoUploading] = useState(false);
  const logoInputRef = useRef(null);

  const handleLogoUpload = useCallback(async (file) => {
    if (!file || logoUploading) return;
    setLogoUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("folder", "company-logos");
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Upload failed");
      }
      const data = await res.json();
      setLogoUrl(data.url);
      toast.success("Logo uploaded");
    } catch (error) {
      toast.error(error.message || "Failed to upload logo");
    } finally {
      setLogoUploading(false);
      if (logoInputRef.current) logoInputRef.current.value = "";
    }
  }, [logoUploading]);

  // Show toast for form-level errors only
  useEffect(() => {
    if (state.errors?._form) {
      toast.error(state.errors._form[0]);
    }
  }, [state.errors]);

  return (
    <form action={formAction} className="space-y-6">
      {isEdit && <input type="hidden" name="companyId" value={company._id} />}

      {state.errors?._form && (
        <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-sm">
          {state.errors._form[0]}
        </div>
      )}

      {/* Basic Information */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            Company Information
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="name">
                Company Name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="name"
                name="name"
                defaultValue={v("name", company?.name || "")}
                placeholder="Acme Trading Ltd"
                className="bg-background"
              />
              {state.errors?.name && (
                <p className="text-sm text-destructive">{state.errors.name[0]}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="code">
                Company Code <span className="text-destructive">*</span>
              </Label>
              <Input
                id="code"
                name="code"
                defaultValue={v("code", company?.code || "")}
                placeholder="ACME"
                className="bg-background uppercase"
                maxLength={6}
              />
              <p className="text-xs text-muted-foreground">
                2-6 chars, used in document numbers
              </p>
              {state.errors?.code && (
                <p className="text-sm text-destructive">{state.errors.code[0]}</p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="tagline">Tagline</Label>
            <Input
              id="tagline"
              name="tagline"
              defaultValue={v("tagline", company?.tagline || "")}
              placeholder="Quality Products, Trusted Service"
              className="bg-background"
            />
          </div>

          <div className="space-y-2">
            <Label>Company Logo</Label>
            <input type="hidden" name="logo" value={logoUrl} />
            <div className="flex items-start gap-4">
              {/* Preview */}
              <div className="w-20 h-20 rounded-lg border-2 border-dashed border-muted-foreground/25 flex items-center justify-center overflow-hidden shrink-0 bg-muted/30">
                {logoUrl ? (
                  <img
                    src={logoUrl}
                    alt="Company logo"
                    className="w-full h-full object-contain p-1"
                  />
                ) : (
                  <Building2 className="w-8 h-8 text-muted-foreground/40" />
                )}
              </div>
              <div className="flex-1 space-y-2">
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={logoUploading}
                    onClick={() => logoInputRef.current?.click()}
                  >
                    {logoUploading ? (
                      <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Uploading...</>
                    ) : (
                      <><Upload className="mr-2 h-4 w-4" /> Upload Logo</>
                    )}
                  </Button>
                  {logoUrl && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setLogoUrl("")}
                    >
                      <X className="mr-1 h-4 w-4" /> Remove
                    </Button>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  PNG or JPEG, used on invoices, quotes, and delivery notes
                </p>
                <input
                  ref={logoInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={(e) => handleLogoUpload(e.target.files?.[0])}
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Contact Information */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Mail className="h-5 w-5" />
            Contact Information
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="email">
                Email <span className="text-destructive">*</span>
              </Label>
              <Input
                id="email"
                name="email"
                type="email"
                defaultValue={v("email", company?.email || "")}
                placeholder="info@company.co.ke"
                className="bg-background"
              />
              {state.errors?.email && (
                <p className="text-sm text-destructive">{state.errors.email[0]}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="phone">Phone</Label>
              <Input
                id="phone"
                name="phone"
                defaultValue={v("phone", company?.phone || "")}
                placeholder="+254 712 345 678"
                className="bg-background"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="website">Website</Label>
            <Input
              id="website"
              name="website"
              defaultValue={v("website", company?.website || "")}
              placeholder="https://www.company.co.ke"
              className="bg-background"
            />
            {state.errors?.website && (
              <p className="text-sm text-destructive">{state.errors.website[0]}</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Address */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <MapPin className="h-5 w-5" />
            Address
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="street">Street Address</Label>
            <Input
              id="street"
              name="street"
              defaultValue={v("street", company?.address?.street || "")}
              placeholder="123 Moi Avenue"
              className="bg-background"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="space-y-2">
              <Label htmlFor="city">City</Label>
              <Input
                id="city"
                name="city"
                defaultValue={v("city", company?.address?.city || "")}
                placeholder="Nairobi"
                className="bg-background"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="state">State/County</Label>
              <Input
                id="state"
                name="state"
                defaultValue={v("state", company?.address?.state || "")}
                placeholder="Nairobi County"
                className="bg-background"
              />
              {state.errors?.state && (
                <p className="text-sm text-destructive">{state.errors.state[0]}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="postalCode">Postal Code</Label>
              <Input
                id="postalCode"
                name="postalCode"
                defaultValue={v("postalCode", company?.address?.postalCode || "")}
                placeholder="00100"
                className="bg-background"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="country">Country</Label>
              <Input
                id="country"
                name="country"
                defaultValue={v("country", company?.address?.country || "Kenya")}
                placeholder="Kenya"
                className="bg-background"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tax & Legal */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Tax & Legal</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="taxPin">KRA PIN</Label>
              <Input
                id="taxPin"
                name="taxPin"
                defaultValue={v("taxPin", company?.taxPin || "")}
                placeholder="P051234567X"
                className="uppercase bg-background"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="vatNumber">VAT Number</Label>
              <Input
                id="vatNumber"
                name="vatNumber"
                defaultValue={v("vatNumber", company?.vatNumber || "")}
                placeholder="VAT123456"
                className="bg-background"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="registrationNumber">Registration No.</Label>
              <Input
                id="registrationNumber"
                name="registrationNumber"
                defaultValue={v("registrationNumber", company?.registrationNumber || "")}
                placeholder="PVT-12345"
                className="bg-background"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Banking Details */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <CreditCard className="h-5 w-5" />
            Bank Details (for invoices)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="bankName">Bank Name</Label>
              <Input
                id="bankName"
                name="bankName"
                defaultValue={v("bankName", company?.bankName || "")}
                placeholder="Equity Bank"
                className="bg-background"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="bankBranch">Branch</Label>
              <Input
                id="bankBranch"
                name="bankBranch"
                defaultValue={v("bankBranch", company?.bankBranch || "")}
                placeholder="Westlands"
                className="bg-background"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="accountName">Account Name</Label>
              <Input
                id="accountName"
                name="accountName"
                defaultValue={v("accountName", company?.accountName || "")}
                placeholder="Acme Trading Ltd"
                className="bg-background"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="accountNumber">Account Number</Label>
              <Input
                id="accountNumber"
                name="accountNumber"
                defaultValue={v("accountNumber", company?.accountNumber || "")}
                placeholder="0123456789012"
                className="bg-background"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="swiftCode">SWIFT Code (optional)</Label>
            <Input
              id="swiftCode"
              name="swiftCode"
              defaultValue={v("swiftCode", company?.swiftCode || "")}
              placeholder="EABORBIIXXX"
              className="bg-background"
            />
          </div>
        </CardContent>
      </Card>

      {/* M-Pesa */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Smartphone className="h-5 w-5" />
            M-Pesa Details
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="mpesaPaybill">Paybill Number</Label>
              <Input
                id="mpesaPaybill"
                name="mpesaPaybill"
                defaultValue={v("mpesaPaybill", company?.mpesaPaybill || "")}
                placeholder="247247"
                className="bg-background"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="mpesaTill">Till Number</Label>
              <Input
                id="mpesaTill"
                name="mpesaTill"
                defaultValue={v("mpesaTill", company?.mpesaTill || "")}
                placeholder="123456"
                className="bg-background"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Settings (only for SuperAdmin creating new companies) */}
      {isSuperAdmin && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Company Settings</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="space-y-2">
                <Label htmlFor="currency">Currency</Label>
                <Select name="currency" defaultValue={v("currency", company?.settings?.currency || "KES")}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="KES">KES - Kenya Shilling</SelectItem>
                    <SelectItem value="USD">USD - US Dollar</SelectItem>
                    <SelectItem value="EUR">EUR - Euro</SelectItem>
                    <SelectItem value="GBP">GBP - British Pound</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="defaultVatRate">VAT Rate (%)</Label>
                <Input
                  id="defaultVatRate"
                  name="defaultVatRate"
                  type="number"
                  defaultValue={v("defaultVatRate", company?.settings?.defaultVatRate ?? 16)}
                  min="0"
                  max="100"
                  className="bg-background"
                />
                {state.errors?.defaultVatRate && (
                  <p className="text-sm text-destructive">{state.errors.defaultVatRate[0]}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="fiscalYearStart">Fiscal Year Start</Label>
                <Select name="fiscalYearStart" defaultValue={v("fiscalYearStart", String(company?.settings?.fiscalYearStart || 1))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">January</SelectItem>
                    <SelectItem value="2">February</SelectItem>
                    <SelectItem value="3">March</SelectItem>
                    <SelectItem value="4">April</SelectItem>
                    <SelectItem value="5">May</SelectItem>
                    <SelectItem value="6">June</SelectItem>
                    <SelectItem value="7">July</SelectItem>
                    <SelectItem value="8">August</SelectItem>
                    <SelectItem value="9">September</SelectItem>
                    <SelectItem value="10">October</SelectItem>
                    <SelectItem value="11">November</SelectItem>
                    <SelectItem value="12">December</SelectItem>
                  </SelectContent>
                </Select>
                {state.errors?.fiscalYearStart && (
                  <p className="text-sm text-destructive">{state.errors.fiscalYearStart[0]}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="defaultPaymentTermsDays">Payment Terms (days)</Label>
                <Input
                  id="defaultPaymentTermsDays"
                  name="defaultPaymentTermsDays"
                  type="number"
                  defaultValue={v("defaultPaymentTermsDays", company?.settings?.defaultPaymentTermsDays ?? 30)}
                  min="0"
                  className="bg-background"
                />
                {state.errors?.defaultPaymentTermsDays && (
                  <p className="text-sm text-destructive">{state.errors.defaultPaymentTermsDays[0]}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="capitalizationThreshold">
                  Capitalization Threshold (KES)
                </Label>
                <Input
                  id="capitalizationThreshold"
                  name="capitalizationThreshold"
                  type="number"
                  min="0"
                  step="1"
                  defaultValue={v(
                    "capitalizationThreshold",
                    company?.settings?.capitalizationThreshold ?? 0
                  )}
                  className="bg-background"
                />
                <p className="text-xs text-muted-foreground">
                  Items below this amount are warned to be expensed instead of
                  capitalized as fixed assets. Set to 0 to disable.
                </p>
                {state.errors?.capitalizationThreshold && (
                  <p className="text-sm text-destructive">
                    {state.errors.capitalizationThreshold[0]}
                  </p>
                )}
              </div>

              {/* Three-way match (SOP §10.1) */}
              <div className="space-y-2 sm:col-span-2 rounded-lg border border-border bg-muted/30 p-4">
                <div className="flex items-start gap-3">
                  <input
                    id="requireGRN"
                    name="requireGRN"
                    type="checkbox"
                    defaultChecked={!!company?.settings?.requireGRN}
                    value="true"
                    className="mt-1 h-4 w-4 rounded border-input"
                  />
                  <div className="space-y-1">
                    <Label htmlFor="requireGRN" className="font-medium">
                      Require Goods Receipt Note for inventory
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Industry-standard three-way match (SOP §10.1). When ON,
                      bill approval no longer credits inventory directly —
                      it posts a GR/IR clearing liability instead. Inventory
                      is admitted only when a Goods Receipt Note is created
                      and accepted by Sales + Finance. Recommended for
                      ISO-audited or industrial operations. Existing approved
                      bills are unaffected; this applies to new approvals
                      going forward.
                    </p>
                    <p className="text-xs text-amber-600 dark:text-amber-400">
                      Requires the GR/IR clearing account
                      (systemAccount: <code>grni</code>) to exist in your
                      Chart of Accounts.
                    </p>
                  </div>
                </div>
                {state.errors?.requireGRN && (
                  <p className="text-sm text-destructive">
                    {state.errors.requireGRN[0]}
                  </p>
                )}
              </div>
            </div>

            {!isEdit && (
              <div className="space-y-2">
                <Label htmlFor="plan">Subscription Plan</Label>
                <Select name="plan" defaultValue="starter">
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="free">Free (2 users)</SelectItem>
                    <SelectItem value="starter">Starter (5 users)</SelectItem>
                    <SelectItem value="professional">Professional (20 users)</SelectItem>
                    <SelectItem value="enterprise">Enterprise (Unlimited)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Submit */}
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
          {isPending ? "Saving..." : isEdit ? "Update Company" : "Create Company"}
        </Button>
      </div>
    </form>
  );
}
