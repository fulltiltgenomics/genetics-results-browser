export interface GeneViewState {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  resourceToggles: { [key: string]: boolean };
  toggleResource: (resource: string) => void;
}
