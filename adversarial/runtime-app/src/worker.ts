import { createHttpHandler } from "@finesoft/front/worker";
import { createFixture } from "./business";
export default createHttpHandler(() => createFixture().options);
