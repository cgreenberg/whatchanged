export interface DataSource<T> {
  id: string
  name: string
  docsUrl: string
  // Any fetcher signature; callers invoke the concrete fetch functions directly
  fetch: (...args: never[]) => Promise<T>
}
