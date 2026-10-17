import { TeamStatus, TeamVisibility } from '../../team/schemas/team.schema';

export type HostSnapshot = {
  name: string;
  image?: string;
  place?: string;
  discoverable: boolean;
};

type LocationBits = {
  city?: string;
  state?: string;
  country?: string;
  address?: string;
};

export function teamSnapshot(team: {
  name: string;
  logo?: string | null;
  visibility: TeamVisibility | string;
  status: TeamStatus | string;
  location?: LocationBits | null;
}): HostSnapshot {
  const logo = team.logo?.trim();
  return {
    name: team.name,
    image: logo || undefined,
    place: placeLabel(team.location),
    discoverable:
      team.visibility === TeamVisibility.PUBLIC &&
      team.status === TeamStatus.ACTIVE,
  };
}

export function tournamentSnapshot(tournament: {
  name: string;
  coverImages?: string[];
  venueName?: string;
  isPublic?: boolean;
}): HostSnapshot {
  const image = tournament.coverImages?.find((url) => url.trim().length > 0);
  const place = tournament.venueName?.trim();
  return {
    name: tournament.name,
    image,
    place: place || undefined,
    discoverable: tournament.isPublic !== false,
  };
}

function placeLabel(location?: LocationBits | null) {
  for (const value of [location?.city, location?.state, location?.country]) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  const address = location?.address?.trim();
  return address || undefined;
}
