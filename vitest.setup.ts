import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

import "@/lib/posts-client.mock";

afterEach(() => {
  cleanup();
});
