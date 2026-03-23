"use client";

import { useActionState, useRef, useState } from "react";
import { Camera, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { uploadEmployeePhoto } from "@/app/mongodb/actions/hr-employee-actions";

const initialState = { success: false, error: null, url: null };

export default function EmployeePhotoUpload({ profileId, currentPhotoUrl, initials }) {
  const [state, formAction, isPending] = useActionState(uploadEmployeePhoto, initialState);
  const [preview, setPreview] = useState(currentPhotoUrl || null);
  const fileRef = useRef(null);

  const displayUrl = state.url || preview;

  function handleFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPreview(URL.createObjectURL(file));
  }

  return (
    <form action={formAction} className="flex flex-col items-center gap-3">
      <input type="hidden" name="profileId" value={profileId} />
      <input
        ref={fileRef}
        type="file"
        name="photo"
        accept="image/*"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* Avatar display */}
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        className="group relative h-24 w-24 overflow-hidden rounded-full border-2 border-border bg-primary/10 hover:border-primary transition-colors"
        title="Click to change photo"
      >
        {displayUrl ? (
          <img src={displayUrl} alt="Employee photo" className="h-full w-full object-cover" />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-2xl font-semibold text-primary">
            {initials}
          </span>
        )}
        <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity">
          <Camera className="h-6 w-6 text-white" />
        </div>
      </button>

      {state.error && (
        <p className="flex items-center gap-1 text-xs text-destructive">
          <AlertCircle className="h-3 w-3" /> {state.error}
        </p>
      )}

      {preview && preview !== currentPhotoUrl && (
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending && <Loader2 className="h-3 w-3 animate-spin" />}
          {isPending ? "Uploading..." : "Save Photo"}
        </Button>
      )}
    </form>
  );
}
