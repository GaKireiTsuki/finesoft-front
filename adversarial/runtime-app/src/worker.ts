import { createHttpHandler } from "@finesoft/front";
import { createFixture } from "./business";
export default createHttpHandler(() => createFixture().options);
