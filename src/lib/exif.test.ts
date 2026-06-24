import { describe, expect, it } from "vitest";
import {
  hostPathForImmichOriginal,
  parseExifCreditJson,
  readAssetExifCredit,
  readExifCredit,
} from "./exif";

describe("EXIF credit parsing", () => {
  it("extracts Artist and Copyright from exiftool JSON", () => {
    expect(
      parseExifCreditJson(
        JSON.stringify([{ Artist: "Ada Lens", Copyright: "Ada Studio" }]),
        "/library/photo.jpg",
      ),
    ).toEqual({
      sourcePath: "/library/photo.jpg",
      artist: "Ada Lens",
      copyright: "Ada Studio",
    });
  });

  it("returns null when no credit fields are present", () => {
    expect(
      parseExifCreditJson(JSON.stringify([{ Model: "Camera" }]), "x"),
    ).toBe(null);
  });

  it("calls exiftool with the requested source path", async () => {
    const credit = await readExifCredit("/library/photo.jpg", {
      runner: async (command, args) => {
        expect(command).toBe("exiftool");
        expect(args.at(-1)).toBe("/library/photo.jpg");
        return JSON.stringify([{ "By-line": "Backup Artist" }]);
      },
    });

    expect(credit?.artist).toBe("Backup Artist");
  });

  it("maps Immich container original paths to the host library root", () => {
    expect(hostPathForImmichOriginal("/data/upload/owner/path/asset.png")).toBe(
      "/opt/immich/library/upload/owner/path/asset.png",
    );
  });

  it("fails open when asset EXIF cannot be read", async () => {
    const credit = await readAssetExifCredit({
      id: "asset-1",
      ownerId: "owner-1",
      originalFileName: "photo.png",
      originalPath: "/data/upload/photo.png",
    });

    expect(credit).toBe(null);
  });
});
