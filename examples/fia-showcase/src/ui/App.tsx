import { CapabilitiesView } from "./views/capabilities";
import { CaptureView } from "./views/capture";
import { FilesView } from "./views/files";
import { HomeView } from "./views/home";
import { ScreenshotsView } from "./views/screenshots";
import { SearchView } from "./views/search";
import { PreviewView } from "./views/preview";

export function App() {
  switch (location.pathname) {
    case "/":
      return <HomeView />;
    case "/screenshots":
      return <ScreenshotsView />;
    case "/search":
      return <SearchView />;
    case "/files":
      return <FilesView />;
    case "/capabilities":
      return <CapabilitiesView />;
    case "/capture":
      return <CaptureView />;
    case "/preview":
      return <PreviewView />;
    default:
      return <HomeView />;
  }
}
