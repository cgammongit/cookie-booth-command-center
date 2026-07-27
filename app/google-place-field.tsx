"use client";

import { useEffect, useRef, useState } from "react";

export type SelectedPlace = {
  locationName: string;
  address: string;
  googlePlaceId: string;
  latitude: number;
  longitude: number;
};

type PlaceLike = {
  id?: string;
  displayName?: string;
  formattedAddress?: string;
  location?: { lat(): number; lng(): number };
  fetchFields(options: { fields: string[] }): Promise<void>;
};

type PlaceSelectEvent = Event & {
  placePrediction?: { toPlace(): PlaceLike };
};

declare global {
  interface Window {
    google?: {
      maps: {
        importLibrary(name: "places"): Promise<{
          PlaceAutocompleteElement: new () => HTMLElement & {
            placeholder: string;
            includedRegionCodes: string[];
            locationBias: {
              center: { lat: number; lng: number };
              radius: number;
            };
          };
        }>;
      };
    };
    __cookieMapsPromise?: Promise<void>;
  }
}

function loadGoogleMaps(apiKey: string) {
  if (window.google?.maps) return Promise.resolve();
  if (window.__cookieMapsPromise) return window.__cookieMapsPromise;

  window.__cookieMapsPromise = new Promise<void>((resolve, reject) => {
    const callback = `cookieMapsReady_${Date.now()}`;
    const callbackWindow = window as unknown as Record<string, unknown>;
    callbackWindow[callback] = () => {
      delete callbackWindow[callback];
      resolve();
    };
    const script = document.createElement("script");
    script.src =
      `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}` +
      `&libraries=places&v=weekly&loading=async&callback=${callback}`;
    script.async = true;
    script.onerror = () => {
      delete callbackWindow[callback];
      reject(new Error("Google Maps could not be loaded"));
    };
    document.head.appendChild(script);
  });
  return window.__cookieMapsPromise;
}

export function GooglePlaceField({
  apiKey,
  value,
  onManualChange,
  onPlaceSelected,
}: {
  apiKey: string;
  value: string;
  onManualChange: (address: string) => void;
  onPlaceSelected: (place: SelectedPlace) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [mapsError, setMapsError] = useState("");

  useEffect(() => {
    if (!apiKey || !hostRef.current) return;
    let active = true;
    let autocomplete: HTMLElement | null = null;

    void loadGoogleMaps(apiKey)
      .then(async () => {
        if (!active || !hostRef.current || !window.google) return;
        const { PlaceAutocompleteElement } =
          await window.google.maps.importLibrary("places");
        if (!active || !hostRef.current) return;
        const element = new PlaceAutocompleteElement();
        element.placeholder = "Search for a business or address";
        element.includedRegionCodes = ["us"];
        element.locationBias = {
          center: { lat: 36.5951, lng: -82.1887 },
          radius: 50_000,
        };
        element.addEventListener("gmp-select", async (rawEvent: Event) => {
          const event = rawEvent as PlaceSelectEvent;
          const place = event.placePrediction?.toPlace();
          if (!place) return;
          await place.fetchFields({
            fields: ["id", "displayName", "formattedAddress", "location"],
          });
          if (!place.formattedAddress || !place.location) return;
          onPlaceSelected({
            locationName: place.displayName || place.formattedAddress,
            address: place.formattedAddress,
            googlePlaceId: place.id || "",
            latitude: place.location.lat(),
            longitude: place.location.lng(),
          });
        });
        hostRef.current.replaceChildren(element);
        autocomplete = element;
      })
      .catch((error: unknown) => {
        if (active) {
          setMapsError(
            error instanceof Error ? error.message : "Google Maps is unavailable",
          );
        }
      });

    return () => {
      active = false;
      autocomplete?.remove();
    };
  }, [apiKey, onPlaceSelected]);

  return (
    <div className="placeField">
      {apiKey && !mapsError ? (
        <div className="placeAutocompleteHost" ref={hostRef}>
          <span>Loading Google Places…</span>
        </div>
      ) : (
        <input
          required
          maxLength={240}
          value={value}
          placeholder="Enter the booth address"
          onChange={(event) => onManualChange(event.target.value)}
        />
      )}
      {apiKey && (
        <input
          className="manualAddressFallback"
          maxLength={240}
          value={value}
          placeholder="Selected address or manual fallback"
          onChange={(event) => onManualChange(event.target.value)}
          required
        />
      )}
      <small>
        {mapsError
          ? `${mapsError}. Enter the address manually.`
          : apiKey
            ? "Choose a Google result, or enter a manual address below."
            : "Manual entry is active until Google Places is configured."}
      </small>
    </div>
  );
}
