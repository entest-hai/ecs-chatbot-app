"use client";

import { useChat } from "ai/react";
import { User, Bot } from "lucide-react";
import { SendIcon, GithubIcon, VercelIcon } from "./icons";
import clsx from "clsx";

export default function Chat() {
  const { messages, input, handleInputChange, handleSubmit } = useChat();

  return (
    <div className="">
      <div className="fixed top-0 hidden sm:flex justify-between items-center w-full py-2 px-10 bg-slate-200">
        <a
          href="#"
          target="_blank"
          className="rounded-lg p-2 transition-colors duration-200 hover:bg-stone-200 sm:bottom-auto"
        >
          <VercelIcon></VercelIcon>
        </a>
        <a
          href="#"
          target="_blank"
          className="rounded-lg p-2 transition-colors duration-200 hover:bg-stone-200 sm:bottom-auto"
        >
          <GithubIcon></GithubIcon>
        </a>
      </div>

      <div className="mx-auto max-w-4xl mt-10 px-5 pt-5 pb-20 bg-white">
        {messages.map((m) => (
          <div
            key={m.id}
            className={clsx(
              "flex w-full justify-center border-b border-gray-200 py-8",
              m.role === "user" ? "bg-white" : "bg-gray-100"
            )}
          >
            <div className="flex w-full items-start space-x-4 px-5 sm:px-0">
              <div
                className={clsx(
                  "p-1.5 text-white",
                  m.role === "assistant" ? "bg-green-500" : "bg-black"
                )}
              >
                {m.role === "user" ? (
                  <User width={20}></User>
                ) : (
                  <Bot width={20}></Bot>
                )}
              </div>
              <div>{m.content}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="fixed bottom-0 w-full py-4">
        <div className="mx-auto max-w-4xl px-5">
          <form
            className="max-w-4xl mx-auto relative shadow-lg rounded-xl border border-gray-200 bg-white px-5"
            onSubmit={handleSubmit}
          >
            <input
              type="text"
              value={input}
              onChange={handleInputChange}
              placeholder="Send a message"
              className="rounded-md w-full py-4 focus:outline-none"
            ></input>
            <button className="absolute inset-y-0 right-7 flex items-center justify-center rounded-md transition-all w-8 my-2 bg-green-500 hover:bg-green-600">
              <SendIcon className="h-4 w-4 text-white"></SendIcon>
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
