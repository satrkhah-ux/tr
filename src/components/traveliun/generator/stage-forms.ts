"use client";

import type { StageKey } from "@/lib/offer/draft-types";
import type { StageFormProps } from "./stage-props";
import { ScopeStage } from "./stages/ScopeStage";
import { CustomerStage } from "./stages/CustomerStage";
import { TripStage } from "./stages/TripStage";
import { CitiesStage } from "./stages/CitiesStage";
import { FlightsStage } from "./stages/FlightsStage";
import { TransportStage } from "./stages/TransportStage";
import { ServicesStage } from "./stages/ServicesStage";
import { TermsStage } from "./stages/TermsStage";
import { VisasStage } from "./stages/VisasStage";
import { ItineraryStage } from "./stages/ItineraryStage";
import { PricingStage } from "./stages/PricingStage";
import { PreviewStage } from "./stages/PreviewStage";

/**
 * Which component edits which slice — the one registry, shared by the card
 * flow and by the eleven stage routes it replaced.
 *
 * `hotels` points at the CITIES form on purpose. The stays live inside their
 * city now, so there is no separate hotels screen; but every hotel validation
 * issue still deep-links to /hotels, and that link has to land somewhere the
 * agent can actually fix it.
 */
export const STAGE_FORMS: Record<StageKey, (props: StageFormProps) => React.ReactNode> = {
  scope: ScopeStage,
  customer: CustomerStage,
  trip: TripStage,
  cities: CitiesStage,
  hotels: CitiesStage,
  flights: FlightsStage,
  transport: TransportStage,
  services: ServicesStage,
  terms: TermsStage,
  visas: VisasStage,
  itinerary: ItineraryStage,
  pricing: PricingStage,
  preview: PreviewStage,
};
