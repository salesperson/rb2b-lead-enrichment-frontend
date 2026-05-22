"use client";

import { useState } from "react";


type ResponseStatus = "ok" | "rejected" | "suppressed" | "error";

type RejectReason =
  | "International TLD"
  | "No Email"
  | "Is Webmail"
  | "Not Deliverable"
  | "Not ICP"
  | "Websearch Failed"
  | "Airtable Write Failed"
  | null;

type PathValue = "cache_hit" | "edu_domain" | "gpt" | null;

type LabType =
  | "hospital_lab" | "physician_office_lab" | "reference_lab"
  | "urgent_care_or_retail_clinic" | "specialty_clinic" | "veterinary"
  | "public_health_lab" | "research_or_academic_lab" | "toxicology_or_drug_testing_lab"
  | "blood_bank_or_donor_center" | "occupational_health"
  | "equipment_distributor_or_reseller" | "other_healthcare"
  | "not_a_lab_buyer" | "unclear" | null;

type CliaComplexity = "waived" | "moderate_or_high" | "unknown" | null;
type Confidence = "high" | "medium" | "low" | null;
type TitleRelevance = "decision_maker" | "influencer" | "not_relevant" | "unknown" | null;

interface Classification {
  lab_type?: LabType;
  clia_complexity?: CliaComplexity;
  confidence?: Confidence;
  evidence?: string | null;
  evidence_url?: string | null;
  company_description?: string | null;
}

interface TitleMeta {
  relevance?: TitleRelevance;
  function?: string | null;
  normalized_title?: string | null;
  title_reason?: string | null;
}

interface VerificationData {
  status?: string;
  score?: number;
  email?: string;
  webmail?: boolean;
  result?: string;
}

interface WebhookResponse {
  status: ResponseStatus;
  reason?: RejectReason;
  path?: PathValue;
  // ok response
  classification?: Classification | null;
  title_meta?: TitleMeta | null;
  verification?: { data?: VerificationData } | null;
  // rejected (Not ICP) — flat classification fields
  lab_type?: LabType;
  clia_complexity?: CliaComplexity;
  confidence?: Confidence;
  evidence?: string | null;
  evidence_url?: string | null;
  company_description?: string | null;
  explanation?: string | null;
  // suppressed
  company_name?: string | null;
  customer_id?: string | null;
  sales_rep?: string | null;
  sales_rep_source?: string | null;
  has_quote?: boolean;
  has_order?: boolean;
  ordertime_url?: string | null;
}

const LAB_TYPE_LABELS: Record<NonNullable<LabType>, string> = {
  hospital_lab:                      "Hospital / Health System Lab",
  physician_office_lab:              "Physician Office Lab",
  reference_lab:                     "Reference / Commercial Lab",
  urgent_care_or_retail_clinic:      "Urgent Care / Retail Clinic",
  specialty_clinic:                  "Specialty Clinic",
  veterinary:                        "Veterinary",
  public_health_lab:                 "Public Health Lab",
  research_or_academic_lab:          "Research / Academic Lab",
  toxicology_or_drug_testing_lab:    "Toxicology / Drug Testing Lab",
  blood_bank_or_donor_center:        "Blood Bank / Donor Center",
  occupational_health:               "Occupational Health",
  equipment_distributor_or_reseller: "Equipment Distributor (not end-user)",
  other_healthcare:                  "Other Healthcare",
  not_a_lab_buyer:                   "Not a Lab Buyer",
  unclear:                           "Unclear",
};

const CLIA_LABELS: Record<NonNullable<CliaComplexity>, string> = {
  waived:           "Waived (point-of-care only)",
  moderate_or_high: "Moderate / High Complexity",
  unknown:          "Unknown",
};

type NodeState = "gray" | "green" | "red" | "skipped" | "suppressed";

const PIPELINE_NODES = [
  "OrderTime Check",
  "Domain Check",
  "Deliverability Check",
  "ICP Classification",
  "Title Classifier",
  "Database Upload",
];

function isPersonLead(form: Record<string, string>): boolean {
  return !!(form["First Name"] || form["Last Name"] || form["Business Email"] || form["Title"]);
}

function getPipelineState(
  res: WebhookResponse | null,
  personLead: boolean
): NodeState[] {
  const skip: NodeState = "skipped";
  const g: NodeState = "green";
  const r: NodeState = "red";
  const gray: NodeState = "gray";

  if (!res) return [gray, gray, personLead ? gray : skip, gray, personLead ? gray : skip, gray];

  if (res.status === "suppressed") return ["suppressed", gray, personLead ? gray : skip, gray, personLead ? gray : skip, gray];

  if (res.status === "ok") return [g, g, personLead ? g : skip, g, personLead ? g : skip, g];

  switch (res.reason) {
    case "International TLD":
      return [g, r, personLead ? gray : skip, gray, personLead ? gray : skip, gray];
    case "No Email":
    case "Is Webmail":
    case "Not Deliverable":
      return [g, g, personLead ? r : skip, gray, personLead ? gray : skip, gray];
    case "Not ICP":
    case "Websearch Failed":
      return [g, g, personLead ? g : skip, r, personLead ? gray : skip, gray];
    case "Airtable Write Failed":
      return [g, g, personLead ? g : skip, g, personLead ? g : skip, r];
    default:
      return [gray, gray, personLead ? gray : skip, gray, personLead ? gray : skip, gray];
  }
}

interface SubNodeInfo {
  label: string;
  color: NodeState;
}

function getIcpSubNodes(path: PathValue, icpState: NodeState): [SubNodeInfo, SubNodeInfo] {
  switch (path) {
    case "cache_hit":
      return [
        { label: "Cache Lookup",  color: "green" },
        { label: "Skipped",       color: "gray"  },
      ];
    case "edu_domain":
      return [
        { label: ".edu Auto-Pass", color: "green" },
        { label: "Skipped",        color: "gray"  },
      ];
    case "gpt":
      return [
        { label: "Cache Lookup",   color: "green"   },
        { label: "LLM Classifier", color: icpState  },
      ];
    default:
      return [
        { label: "Cache Lookup",   color: "gray" },
        { label: "LLM Classifier", color: "gray" },
      ];
  }
}


function getResultMessage(res: WebhookResponse): { icon: string; title: string; body: string; color: string } {
  if (res.status === "ok") {
    return {
      icon: "✅",
      title: "ICP Pass",
      body: "This lead passed all filters and was sent to Airtable.",
      color: "text-green-700 bg-green-50 border-green-200",
    };
  }
  if (res.status === "suppressed") {
    return {
      icon: "🛑",
      title: "Existing Customer",
      body: `${res.company_name ?? "This company"} is already a customer.`,
      color: "text-amber-700 bg-amber-50 border-amber-200",
    };
  }
  if (res.status === "rejected") {
    switch (res.reason) {
      case "Not ICP":
        return {
          icon: "⛔",
          title: "Not a match",
          body: "This company does not fit our ideal customer profile.",
          color: "text-red-700 bg-red-50 border-red-200",
        };
      case "Not Deliverable":
        return {
          icon: "🚫",
          title: "Invalid email",
          body: "This email address could not be verified as deliverable.",
          color: "text-orange-700 bg-orange-50 border-orange-200",
        };
      case "Is Webmail":
        return {
          icon: "🚫",
          title: "Personal email",
          body: "We only accept business email addresses (no Gmail, Yahoo, etc.).",
          color: "text-orange-700 bg-orange-50 border-orange-200",
        };
      case "International TLD":
        return {
          icon: "🚫",
          title: "International domain",
          body: "We currently only process leads from supported regions.",
          color: "text-orange-700 bg-orange-50 border-orange-200",
        };
      case "No Email":
        return {
          icon: "🚫",
          title: "No email address",
          body: "A business email is required to process this lead.",
          color: "text-orange-700 bg-orange-50 border-orange-200",
        };
      case "Websearch Failed":
        return {
          icon: "⚠️",
          title: "Could not classify",
          body: "We were unable to find enough information about this company to make a decision.",
          color: "text-yellow-700 bg-yellow-50 border-yellow-200",
        };
      case "Airtable Write Failed":
        return {
          icon: "💥",
          title: "Write failed",
          body: "Lead passed ICP but could not be saved. Please try again.",
          color: "text-red-700 bg-red-50 border-red-200",
        };
    }
  }
  return {
    icon: "💥",
    title: "Error",
    body: `Something went wrong.${res.reason ? ` (${res.reason})` : ""}`,
    color: "text-red-700 bg-red-50 border-red-200",
  };
}

export default function IcpDemo() {
  const [tab, setTab] = useState<"form" | "json">("form");
  const [form, setForm] = useState({
    "Business Email": "chris.miller@epic.com",
    "First Name": "Chris",
    "Last Name": "Miller",
    "Title": "Implementation Consultant",
    "Company Name": "Epic Systems",
    "Website": "epic.com",
    "City": "Verona",
    "State": "WI",
  });
  const [rawJson, setRawJson] = useState(() =>
    JSON.stringify({
      "Business Email": "chris.miller@epic.com",
      "First Name": "Chris",
      "Last Name": "Miller",
      "Title": "Implementation Consultant",
      "Company Name": "Epic Systems",
      "Website": "epic.com",
      "City": "Verona",
      "State": "WI",
    }, null, 2)
  );
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [testMode, setTestMode] = useState(false);
  const [disableCache, setDisableCache] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<WebhookResponse | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  function buildFormPayload() {
    return {
      "Business Email": form["Business Email"] || null,
      "First Name": form["First Name"] || null,
      "Last Name": form["Last Name"] || null,
      "Title": form["Title"] || null,
      "Company Name": form["Company Name"] || null,
      "Website": form["Website"] || null,
      "City": form["City"] || null,
      "State": form["State"] || null,
    };
  }

  async function handleSubmit() {
    setResult(null);
    setFetchError(null);
    setJsonError(null);

    let payload: Record<string, unknown>;

    if (tab === "json") {
      try {
        payload = JSON.parse(rawJson);
      } catch {
        setJsonError("Invalid JSON — please fix before submitting.");
        return;
      }
    } else {
      payload = buildFormPayload();
    }

    if (testMode) payload["Is Test Email"] = true;
    if (disableCache) payload["Disable Cache"] = true;

    setLoading(true);
    try {
      const res = await fetch("https://rb2b-lead-enrichment-middleware-ddh.vercel.app/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data: WebhookResponse = await res.json();
      console.log("[webhook response]", data);
      setResult(data);
    } catch (err) {
      setFetchError(
        err instanceof Error ? err.message : "Network error — is the server running?"
      );
    } finally {
      setLoading(false);
    }
  }

  const msg = result ? getResultMessage(result) : null;
  const personLead = isPersonLead(form);
  const pipelineState = getPipelineState(loading ? null : result, personLead);
  const [icpSub1, icpSub2] = getIcpSubNodes(result?.path ?? null, pipelineState[3]);

  const nodeColor: Record<NodeState, string> = {
    gray:       "bg-gray-200 border-gray-300 text-gray-400",
    green:      "bg-green-500 border-green-600 text-white",
    red:        "bg-red-500 border-red-600 text-white",
    skipped:    "bg-gray-100 border-gray-200 text-gray-300",
    suppressed: "bg-amber-400 border-amber-500 text-white",
  };
  const lineColor: Record<NodeState, string> = {
    gray:       "bg-gray-200",
    green:      "bg-green-500",
    red:        "bg-gray-200",
    skipped:    "bg-gray-100",
    suppressed: "bg-gray-200",
  };

  function NodeCircle({ state, index }: { state: NodeState; index: number }) {
    return (
      <div className={`w-7 h-7 rounded-full border-2 flex items-center justify-center flex-shrink-0 text-xs font-bold transition-colors duration-300 ${nodeColor[state]}`}>
        {state === "green" ? "✓" : state === "red" ? "✕" : state === "suppressed" ? "!" : index}
      </div>
    );
  }

  function SubCircle({ state }: { state: NodeState }) {
    return (
      <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors duration-300 ${nodeColor[state]}`}>
        {state === "green" ? (
          <svg className="w-2.5 h-2.5" viewBox="0 0 10 10" fill="currentColor"><path d="M1.5 5l2.5 2.5 4.5-4.5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round"/></svg>
        ) : state === "red" ? (
          <svg className="w-2.5 h-2.5" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M2.5 2.5l5 5M7.5 2.5l-5 5"/></svg>
        ) : null}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-start justify-center pt-12 px-4">
      <div className="w-full max-w-5xl flex gap-8">
        {/* Left column */}
        <div className="flex-1 space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">ICP Filter Demo</h1>
          <p className="text-sm text-gray-500 mt-1">
            Submit a lead payload to the webhook and see the classification result.
          </p>
        </div>

        {/* Input panel */}
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
          {/* Tabs */}
          <div className="flex border-b border-gray-200">
            <button
              onClick={() => setTab("form")}
              className={`px-5 py-3 text-sm font-medium transition-colors ${
                tab === "form"
                  ? "text-blue-600 border-b-2 border-blue-600 bg-white"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              Form
            </button>
            <button
              onClick={() => { setRawJson(JSON.stringify(buildFormPayload(), null, 2)); setTab("json"); }}
              className={`px-5 py-3 text-sm font-medium transition-colors ${
                tab === "json"
                  ? "text-blue-600 border-b-2 border-blue-600 bg-white"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              Raw JSON
            </button>
          </div>

          <div className="p-6">
            {tab === "form" ? (
              <div className="grid grid-cols-2 gap-4">
                {(
                  [
                    "Business Email",
                    "First Name",
                    "Last Name",
                    "Title",
                    "Company Name",
                    "Website",
                    "City",
                    "State",
                  ] as const
                ).map((field) => (
                  <div
                    key={field}
                    className={field === "Business Email" || field === "Title" || field === "Company Name" || field === "Website" ? "col-span-2" : ""}
                  >
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      {field}
                    </label>
                    <input
                      type="text"
                      value={form[field]}
                      onChange={(e) =>
                        setForm((prev) => ({ ...prev, [field]: e.target.value }))
                      }
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                ))}
              </div>
            ) : (
              <div>
                <textarea
                  value={rawJson}
                  onChange={(e) => {
                    setRawJson(e.target.value);
                    setJsonError(null);
                  }}
                  rows={18}
                  spellCheck={false}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                />
                {jsonError && (
                  <p className="mt-2 text-sm text-red-600">{jsonError}</p>
                )}
              </div>
            )}

            <label className="mt-4 flex items-center gap-2 cursor-pointer select-none w-fit">
              <input
                type="checkbox"
                checked={testMode}
                onChange={(e) => setTestMode(e.target.checked)}
                className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-600">Skip Email Verification</span>
            </label>
            <label className="mt-2 flex items-center gap-2 cursor-pointer select-none w-fit">
              <input
                type="checkbox"
                checked={disableCache}
                onChange={(e) => setDisableCache(e.target.checked)}
                className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-600">Disable Cache</span>
            </label>

            <button
              onClick={handleSubmit}
              disabled={loading}
              className="mt-4 w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 disabled:cursor-not-allowed text-white font-medium py-2.5 rounded-lg text-sm transition-colors"
            >
              {loading ? "Submitting..." : "Submit"}
            </button>
          </div>
        </div>

        {/* Result panel */}
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm min-h-[120px] p-6">
          {loading && (
            <div className="flex flex-col items-center gap-3 text-gray-400">
              <svg className="animate-spin h-8 w-8" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              <span className="text-sm">Classifying lead... this may take up to 15 seconds</span>
            </div>
          )}

          {!loading && fetchError && (
            <div className="border rounded-lg p-4 text-red-700 bg-red-50 border-red-200">
              <p className="font-medium">💥 Network Error</p>
              <p className="text-sm mt-1">{fetchError}</p>
            </div>
          )}

          {!loading && !fetchError && result && msg && (() => {
            // Suppressed — existing customer
            if (result.status === "suppressed") {
              return (
                <div>
                  <div className="flex items-center gap-3 mb-4">
                    <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold bg-amber-100 text-amber-700">
                      🛑 EXISTING CUSTOMER
                    </span>
                  </div>
                  <dl className="space-y-2">
                    {result.company_name && (
                      <div className="flex gap-2">
                        <dt className="text-xs font-medium text-gray-500 w-36 flex-shrink-0 pt-0.5">Company</dt>
                        <dd className="text-sm text-gray-900">{result.company_name}</dd>
                      </div>
                    )}
                    {result.sales_rep && (
                      <div className="flex gap-2">
                        <dt className="text-xs font-medium text-gray-500 w-36 flex-shrink-0 pt-0.5">Sales Rep</dt>
                        <dd className="text-sm text-gray-900">{result.sales_rep}</dd>
                      </div>
                    )}
                    {result.customer_id && (
                      <div className="flex gap-2">
                        <dt className="text-xs font-medium text-gray-500 w-36 flex-shrink-0 pt-0.5">Customer ID</dt>
                        <dd className="text-sm text-gray-900">{result.customer_id}</dd>
                      </div>
                    )}
                    {(result.has_quote || result.has_order) && (
                      <div className="flex gap-2">
                        <dt className="text-xs font-medium text-gray-500 w-36 flex-shrink-0 pt-0.5">Activity</dt>
                        <dd className="text-sm text-gray-900">
                          {[result.has_quote && "Has quote", result.has_order && "Has order"].filter(Boolean).join(" · ")}
                        </dd>
                      </div>
                    )}
                    {result.ordertime_url && (
                      <div className="flex gap-2">
                        <dt className="text-xs font-medium text-gray-500 w-36 flex-shrink-0 pt-0.5">Record</dt>
                        <dd className="text-sm">
                          <a href={result.ordertime_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline break-all">
                            View in system
                          </a>
                        </dd>
                      </div>
                    )}
                  </dl>
                </div>
              );
            }

            // ok or Not ICP — show full classification card
            const isClassified = result.status === "ok" || result.reason === "Not ICP";
            if (isClassified) {
              const passed = result.status === "ok";
              // classification fields: nested on ok, flat on rejected Not ICP
              const cls = result.classification ?? result;
              const tm = result.title_meta;
              const vd = result.verification?.data;
              const titleNote = tm?.relevance === "not_relevant"
                ? "Title not directly relevant — flagged for stakeholder discovery."
                : null;

              return (
                <div>
                  <div className="flex items-center gap-3 mb-4">
                    <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold ${passed ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                      {passed ? "✅ PASSED" : "⛔ REJECTED"}
                    </span>
                    {!passed && result.reason && (
                      <span className="text-sm text-gray-500">{result.reason}</span>
                    )}
                  </div>

                  {titleNote && (
                    <div className="mb-4 px-3 py-2 rounded-md bg-yellow-50 border border-yellow-200 text-yellow-700 text-sm">
                      {titleNote}
                    </div>
                  )}

                  {cls.company_description && (
                    <p className="text-sm text-gray-700 mb-4">{cls.company_description}</p>
                  )}

                  <dl className="space-y-2">
                    {cls.lab_type && (
                      <div className="flex gap-2">
                        <dt className="text-xs font-medium text-gray-500 w-36 flex-shrink-0 pt-0.5">Lab Type</dt>
                        <dd className="text-sm text-gray-900">{LAB_TYPE_LABELS[cls.lab_type]}</dd>
                      </div>
                    )}
                    {cls.clia_complexity && (
                      <div className="flex gap-2">
                        <dt className="text-xs font-medium text-gray-500 w-36 flex-shrink-0 pt-0.5">CLIA Complexity</dt>
                        <dd className="text-sm text-gray-900">{CLIA_LABELS[cls.clia_complexity]}</dd>
                      </div>
                    )}
                    {cls.confidence && (
                      <div className="flex gap-2">
                        <dt className="text-xs font-medium text-gray-500 w-36 flex-shrink-0 pt-0.5">Confidence</dt>
                        <dd className="text-sm text-gray-900 capitalize">{cls.confidence}</dd>
                      </div>
                    )}
                    {cls.evidence && (
                      <div className="flex gap-2">
                        <dt className="text-xs font-medium text-gray-500 w-36 flex-shrink-0 pt-0.5">Evidence</dt>
                        <dd className="text-sm text-gray-900">{cls.evidence}</dd>
                      </div>
                    )}
                    {cls.evidence_url && (
                      <div className="flex gap-2">
                        <dt className="text-xs font-medium text-gray-500 w-36 flex-shrink-0 pt-0.5">Source</dt>
                        <dd className="text-sm">
                          <a href={cls.evidence_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline break-all">
                            {cls.evidence_url}
                          </a>
                        </dd>
                      </div>
                    )}
                    {result.explanation && (
                      <div className="flex gap-2">
                        <dt className="text-xs font-medium text-gray-500 w-36 flex-shrink-0 pt-0.5">Explanation</dt>
                        <dd className="text-sm text-gray-900 italic">{result.explanation}</dd>
                      </div>
                    )}
                    {tm?.normalized_title && (
                      <div className="flex gap-2">
                        <dt className="text-xs font-medium text-gray-500 w-36 flex-shrink-0 pt-0.5">Title</dt>
                        <dd className="text-sm text-gray-900">{tm.normalized_title}</dd>
                      </div>
                    )}
                    {tm?.relevance && (
                      <div className="flex gap-2">
                        <dt className="text-xs font-medium text-gray-500 w-36 flex-shrink-0 pt-0.5">Title Relevance</dt>
                        <dd className="text-sm text-gray-900 capitalize">{tm.relevance.replace(/_/g, " ")}</dd>
                      </div>
                    )}
                    {tm?.title_reason && (
                      <div className="flex gap-2">
                        <dt className="text-xs font-medium text-gray-500 w-36 flex-shrink-0 pt-0.5">Title Reason</dt>
                        <dd className="text-sm text-gray-900">{tm.title_reason}</dd>
                      </div>
                    )}
                    {vd?.result && (
                      <div className="flex gap-2">
                        <dt className="text-xs font-medium text-gray-500 w-36 flex-shrink-0 pt-0.5">Email Check</dt>
                        <dd className="text-sm text-gray-900 capitalize">{vd.result}{vd.score != null ? ` (score: ${vd.score})` : ""}</dd>
                      </div>
                    )}
                  </dl>
                </div>
              );
            }

            // Simple rejection (domain, no email, webmail, undeliverable) or error
            return (
              <div className={`border rounded-lg p-4 ${msg.color}`}>
                <p className="font-semibold text-base">{msg.icon} {msg.title}</p>
                <p className="text-sm mt-1">{msg.body}</p>
              </div>
            );
          })()}

          {!loading && !fetchError && !result && (
            <div className="flex items-center justify-center h-full min-h-[72px]">
              <p className="text-sm text-gray-400">Results will appear here after submission.</p>
            </div>
          )}
        </div>
        </div>{/* end left column */}

        {/* Right column — Pipeline */}
        <div className="w-52 pt-[72px] flex-shrink-0">
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-5">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-5">Pipeline</p>

            {/* Node 1 — OrderTime Check */}
            <div className="flex gap-3">
              <div className="flex flex-col items-center w-7 flex-shrink-0">
                <NodeCircle state={pipelineState[0]} index={1} />
                <div className={`w-0.5 h-5 mt-0.5 transition-colors duration-300 ${lineColor[pipelineState[0]]}`} />
              </div>
              <p className="text-sm text-gray-700 pt-1">{PIPELINE_NODES[0]}</p>
            </div>

            {/* Node 2 — Domain Check */}
            <div className="flex gap-3">
              <div className="flex flex-col items-center w-7 flex-shrink-0">
                <NodeCircle state={pipelineState[1]} index={2} />
                <div className={`w-0.5 h-5 mt-0.5 transition-colors duration-300 ${lineColor[pipelineState[1]]}`} />
              </div>
              <p className="text-sm text-gray-700 pt-1">{PIPELINE_NODES[1]}</p>
            </div>

            {/* Node 3 — Deliverability Check (skipped for company leads or test mode) */}
            <div className="flex gap-3">
              <div className="flex flex-col items-center w-7 flex-shrink-0">
                <NodeCircle state={testMode ? "skipped" : pipelineState[2]} index={3} />
                <div className={`w-0.5 h-5 mt-0.5 transition-colors duration-300 ${lineColor[testMode ? "skipped" : pipelineState[2]]}`} />
              </div>
              <div className="pt-1">
                <p className={`text-sm ${(testMode || pipelineState[2] === "skipped") ? "text-gray-400" : "text-gray-700"}`}>{PIPELINE_NODES[2]}</p>
                {(testMode || pipelineState[2] === "skipped") && (
                  <p className="text-xs text-gray-400 leading-tight">{testMode ? "Skipped (test mode)" : "Skipped"}</p>
                )}
              </div>
            </div>

            {/* Node 4 — ICP Classification with sub-nodes */}
            <div className="flex gap-3">
              <div className="flex flex-col items-center w-7 flex-shrink-0">
                <NodeCircle state={pipelineState[3]} index={4} />
                <div className={`w-0.5 flex-1 mt-0.5 transition-colors duration-300 ${lineColor[pipelineState[3]]}`} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-700 pt-1 mb-3">{PIPELINE_NODES[3]}</p>
                <div className="flex gap-2 ml-1">
                  <div className="flex flex-col items-center w-5 flex-shrink-0">
                    <SubCircle state={icpSub1.color} />
                    <div className={`w-0.5 h-4 mt-0.5 transition-colors duration-300 ${lineColor[icpSub1.color]}`} />
                  </div>
                  <p className="text-xs text-gray-600 pt-0.5 leading-tight">{icpSub1.label}</p>
                </div>
                <div className="flex gap-2 ml-1 mb-3">
                  <div className="flex flex-col items-center w-5 flex-shrink-0">
                    <SubCircle state={icpSub2.color} />
                  </div>
                  <p className="text-xs text-gray-600 pt-0.5 leading-tight">{icpSub2.label}</p>
                </div>
              </div>
            </div>

            {/* Node 5 — Title Classifier (skipped for company leads) */}
            <div className="flex gap-3">
              <div className="flex flex-col items-center w-7 flex-shrink-0">
                <NodeCircle state={pipelineState[4]} index={5} />
                <div className={`w-0.5 h-5 mt-0.5 transition-colors duration-300 ${lineColor[pipelineState[4]]}`} />
              </div>
              <div className="pt-1">
                <p className={`text-sm ${pipelineState[4] === "skipped" ? "text-gray-400" : "text-gray-700"}`}>{PIPELINE_NODES[4]}</p>
                {pipelineState[4] === "skipped" && <p className="text-xs text-gray-400 leading-tight">Skipped</p>}
              </div>
            </div>

            {/* Node 6 — Database Upload with person/company sub-nodes */}
            <div className="flex gap-3">
              <div className="flex flex-col items-center w-7 flex-shrink-0">
                <NodeCircle state={pipelineState[5]} index={6} />
                <div className={`w-0.5 flex-1 mt-0.5 transition-colors duration-300 ${lineColor[pipelineState[5]]}`} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-700 pt-1 mb-3">{PIPELINE_NODES[5]}</p>
                {[
                  { label: "Person Visitor",  active: personLead },
                  { label: "Company Visitor", active: !personLead },
                ].map(({ label, active }) => (
                  <div key={label} className="flex gap-2 ml-1 mb-2">
                    <div className="flex flex-col items-center w-5 flex-shrink-0">
                      <SubCircle state="gray" />
                    </div>
                    <p className={`text-xs pt-0.5 leading-tight ${!active && result ? "text-gray-300 line-through" : "text-gray-600"}`}>
                      {label}
                    </p>
                  </div>
                ))}
              </div>
            </div>

          </div>
        </div>

      </div>
    </div>
  );
}
