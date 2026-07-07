import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { registerLink } from "./link-registry";
import {
  MAX_MESSAGE_LENGTH,
  markThreadRead,
  readMessages,
  readThread,
  readThreadsForOwner,
  sendMessage,
} from "./messages";
import { writeWalletRegistry } from "./registry";

async function paths() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "aperture-messages-"));
  return {
    messagePath: path.join(dir, "messages.json"),
    linkPath: path.join(dir, "links.json"),
    registryPath: path.join(dir, "registry.json"),
  };
}

describe("messages", () => {
  let testPaths: Awaited<ReturnType<typeof paths>>;

  beforeEach(async () => {
    testPaths = await paths();
    await writeWalletRegistry(
      {
        photographers: [
          {
            ownerId: "seller-1",
            displayName: "Seller Lens",
            wallet: "0x1111111111111111111111111111111111111111",
            createdAt: "2026-07-07T00:00:00.000Z",
            approvalStatus: "operator-approved",
          },
          {
            ownerId: "buyer-1",
            displayName: "Buyer One",
            wallet: "0x2222222222222222222222222222222222222222",
            createdAt: "2026-07-07T00:00:00.000Z",
            approvalStatus: "operator-approved",
          },
          {
            ownerId: "buyer-2",
            displayName: "Buyer Two",
            wallet: "0x3333333333333333333333333333333333333333",
            createdAt: "2026-07-07T00:00:00.000Z",
            approvalStatus: "operator-approved",
          },
        ],
      },
      testPaths.registryPath,
    );
    await registerLink(
      {
        id: "link-1",
        title: "Street Photo",
        ownerId: "seller-1",
        sourceUrl: "https://example.com/photo.jpg",
      },
      testPaths.linkPath,
    );
  });

  it("returns an empty store when messages are missing", async () => {
    await expect(readMessages(testPaths.messagePath)).resolves.toEqual({
      messages: [],
    });
  });

  it("validates body length and participants before appending", async () => {
    await expect(
      sendMessage(
        {
          linkId: "link-1",
          buyerOwnerId: "buyer-1",
          senderOwnerId: "buyer-1",
          body: "   ",
        },
        testPaths,
      ),
    ).rejects.toThrow("message body is required");
    await expect(
      sendMessage(
        {
          linkId: "link-1",
          buyerOwnerId: "buyer-1",
          senderOwnerId: "buyer-1",
          body: "x".repeat(MAX_MESSAGE_LENGTH + 1),
        },
        testPaths,
      ),
    ).rejects.toThrow("characters or fewer");
    await expect(
      sendMessage(
        {
          linkId: "link-1",
          buyerOwnerId: "buyer-1",
          senderOwnerId: "stranger",
          body: "hello",
        },
        testPaths,
      ),
    ).rejects.toThrow("not a participant");
  });

  it("reads only the requested thread in chronological order", async () => {
    const first = await sendMessage(
      {
        linkId: "link-1",
        buyerOwnerId: "buyer-1",
        senderOwnerId: "buyer-1",
        body: "  License terms?  ",
      },
      testPaths,
    );
    await sendMessage(
      {
        linkId: "link-1",
        buyerOwnerId: "buyer-2",
        senderOwnerId: "buyer-2",
        body: "Different buyer.",
      },
      testPaths,
    );
    const second = await sendMessage(
      {
        linkId: "link-1",
        buyerOwnerId: "buyer-1",
        senderOwnerId: "seller-1",
        body: "Editorial use is fine.",
      },
      testPaths,
    );

    const thread = await readThread(
      "link-1",
      "buyer-1",
      testPaths.messagePath,
    );

    expect(thread.map((message) => message.id)).toEqual([first.id, second.id]);
    expect(thread[0].body).toBe("License terms?");
  });

  it("aggregates inbox threads and drops unread counts after marking read", async () => {
    await sendMessage(
      {
        linkId: "link-1",
        buyerOwnerId: "buyer-1",
        senderOwnerId: "buyer-1",
        body: "Can I use this commercially?",
      },
      testPaths,
    );
    await sendMessage(
      {
        linkId: "link-1",
        buyerOwnerId: "buyer-2",
        senderOwnerId: "buyer-2",
        body: "Can I license a crop?",
      },
      testPaths,
    );

    const sellerInbox = await readThreadsForOwner("seller-1", testPaths);
    expect(sellerInbox).toHaveLength(2);
    expect(sellerInbox[0]).toEqual(
      expect.objectContaining({
        linkTitle: "Street Photo",
        counterpartyName: expect.stringMatching(/^Buyer/),
        viewerRole: "seller",
        unreadCount: 1,
      }),
    );

    await markThreadRead("link-1", "buyer-1", "seller-1", testPaths);
    const updatedSellerInbox = await readThreadsForOwner("seller-1", testPaths);
    const buyerOneThread = updatedSellerInbox.find(
      (thread) => thread.buyerOwnerId === "buyer-1",
    );
    expect(buyerOneThread?.unreadCount).toBe(0);
  });

  it("prevents a stranger from marking another thread read", async () => {
    await sendMessage(
      {
        linkId: "link-1",
        buyerOwnerId: "buyer-1",
        senderOwnerId: "buyer-1",
        body: "hello",
      },
      testPaths,
    );

    await expect(
      markThreadRead("link-1", "buyer-1", "buyer-2", testPaths),
    ).rejects.toThrow("not a participant");
  });
});
