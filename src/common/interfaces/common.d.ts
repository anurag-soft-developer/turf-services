export interface PaginatedResult<T> {
  data: T[];
  totalDocuments: number;
  page: number;
  limit: number;
  totalPages: number;
}
