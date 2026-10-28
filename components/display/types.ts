import type { EventsResponse } from "@/lib/events";
import type { Photo } from "@/lib/smugmug";
import type { FamilyMember } from "@/lib/household";

export type { EventsResponse, Photo };

export type Config = {
  units: "F" | "C";
  outdoorKeywords: string[];
  rotationSeconds: number;
  nightStart: string;
  nightEnd: string;
  familyMembers: FamilyMember[];
  photoSourceName: string;
  hasWeather: boolean;
  hasPin: boolean;
  pinUnlocked: boolean;
  recentGuests: string[];
};
