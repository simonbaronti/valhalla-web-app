import { useCallback } from 'react';

import { downloadFile } from '@/utils/download-file';
import { Summary } from './summary';
import { Button } from '@/components/ui/button';
import type { ParsedDirectionsGeometry } from '@/components/types';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Download, Save } from 'lucide-react';
import { cn } from '@/lib/utils';
import { exportDataAsJson } from '@/utils/export';
import { getDateTimeString } from '@/utils/date-time';
import { isEmbedMode, postRouteToParent } from '@/utils/embed-mode';

interface RouteCardProps {
  data: ParsedDirectionsGeometry;
  index: number;
  isActive: boolean;
  onSelect: () => void;
}

export const RouteCard = ({
  data,
  index,
  isActive,
  onSelect,
}: RouteCardProps) => {
  const exportToGeoJson = useCallback(() => {
    const coordinates = data?.decodedGeometry;
    if (!coordinates) return;

    const geoJsonCoordinates = coordinates.map(([lat, lng]) => [lng, lat]);

    const geoJson = {
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: geoJsonCoordinates,
      },
      properties: {},
    };

    const formattedData = JSON.stringify(geoJson, null, 2);
    downloadFile({
      data: formattedData,
      fileName: 'valhalla-directions_' + getDateTimeString() + '.geojson',
      fileType: 'text/json',
    });
  }, [data]);

  if (!data.trip) {
    return null;
  }

  return (
    <>
      <div
        className={cn(
          'flex flex-col gap-2.5 border rounded-md p-2 cursor-pointer transition-colors',
          'focus-within:bg-muted/50 hover:bg-muted/50',
          'bg-background',
          isActive && 'border-l-4 border-l-primary'
        )}
        onClick={onSelect}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelect();
          }
        }}
      >
        <Summary
          title={`${index === 0 ? 'Main Route' : 'Alternate Route #' + index}`}
          summary={data.trip.summary}
          index={index}
          routeCoordinates={data.decodedGeometry ?? []}
        />
        {isEmbedMode ? (
          <Button
            variant="default"
            size="sm"
            className="w-full"
            onClick={(e) => {
              e.stopPropagation();
              postRouteToParent(data);
            }}
          >
            <Save className="size-4" />
            Save Route
          </Button>
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="w-full">
                <Download className="size-4" />
                Export
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem
                onClick={() => exportDataAsJson(data, 'valhalla-directions')}
              >
                JSON
              </DropdownMenuItem>
              <DropdownMenuItem onClick={exportToGeoJson}>
                GeoJSON
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </>
  );
};
