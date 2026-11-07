"""Standalone visual preview for the experimental microscopic traffic model."""

from __future__ import annotations

import tkinter as tk
from tkinter import ttk

import traffic_micro


COLORS = {
    "page": "#f3f5f2",
    "surface": "#ffffff",
    "ink": "#26343a",
    "muted": "#627078",
    "line": "#dce4e0",
    "road": "#59646a",
    "road_mark": "#e5e9e5",
    "blue": "#286d72",
    "blue_pale": "#e8f1ef",
    "green": "#39836d",
    "amber": "#bf7626",
}

VEHICLE_COLORS = {
    traffic_micro.VehicleClass.PASSENGER_CAR: "#a9d8c4",
    traffic_micro.VehicleClass.MOTORCYCLE: "#f0d39f",
    traffic_micro.VehicleClass.AUTO_RICKSHAW: "#dfbd74",
    traffic_micro.VehicleClass.BUS: "#91b9c9",
    traffic_micro.VehicleClass.HEAVY_GOODS_VEHICLE: "#c5b7a3",
}

VEHICLE_LABELS = {
    traffic_micro.VehicleClass.PASSENGER_CAR: "Cars",
    traffic_micro.VehicleClass.MOTORCYCLE: "Motorcycles",
    traffic_micro.VehicleClass.AUTO_RICKSHAW: "Auto-rickshaws",
    traffic_micro.VehicleClass.BUS: "Buses",
    traffic_micro.VehicleClass.HEAVY_GOODS_VEHICLE: "Heavy goods",
}


class MicroscopicPreview(tk.Tk):
    """Small standalone viewer for saved microscopic simulation snapshots."""

    def __init__(self) -> None:
        super().__init__()
        self.title("Flowline | Microscopic model preview")
        self.geometry("1120x760")
        self.minsize(820, 620)
        self.configure(bg=COLORS["page"])

        self.states: tuple[traffic_micro.SimulationState, ...] = ()
        self.current_index = 0
        self.playing = False
        self.after_id: str | None = None
        self._updating_timeline = False
        self.seed_var = tk.StringVar(value="41")
        self.duration_var = tk.StringVar(value="30 s")
        self.time_var = tk.StringVar(value="0.0 s")
        self.count_var = tk.StringVar(value="—")
        self.speed_var = tk.StringVar(value="—")
        self.exited_var = tk.StringVar(value="0")
        self.braking_var = tk.StringVar(value="0")
        self.contacts_var = tk.StringVar(value="0")
        self.lane_changes_var = tk.StringVar(value="0")
        self.status_var = tk.StringVar(value="Choose a seed and run the preview.")
        self._build_layout()
        self._generate_run()

    def _build_layout(self) -> None:
        self.grid_columnconfigure(0, weight=1)
        self.grid_rowconfigure(1, weight=1)

        header = tk.Frame(self, bg=COLORS["surface"], highlightbackground=COLORS["line"], highlightthickness=1)
        header.grid(row=0, column=0, sticky="ew")
        header.grid_columnconfigure(0, weight=1)
        title_block = tk.Frame(header, bg=COLORS["surface"])
        title_block.grid(row=0, column=0, sticky="w", padx=24, pady=17)
        tk.Label(
            title_block, text="Flowline", font=("Segoe UI", 19, "bold"),
            fg=COLORS["ink"], bg=COLORS["surface"],
        ).pack(anchor="w")
        tk.Label(
            title_block, text="Microscopic traffic model · experimental preview",
            font=("Segoe UI", 10), fg=COLORS["muted"], bg=COLORS["surface"],
        ).pack(anchor="w", pady=(2, 0))
        tk.Label(
            header, text="NOT CALIBRATED", font=("Segoe UI", 9, "bold"),
            fg="#74420e", bg="#fff2df", padx=10, pady=6,
        ).grid(row=0, column=1, padx=24)

        content = tk.Frame(self, bg=COLORS["page"])
        content.grid(row=1, column=0, sticky="nsew", padx=24, pady=20)
        content.grid_columnconfigure(0, weight=1)
        content.grid_rowconfigure(1, weight=1)

        controls = tk.Frame(content, bg=COLORS["page"])
        controls.grid(row=0, column=0, sticky="ew", pady=(0, 14))
        tk.Label(controls, text="Seed", font=("Segoe UI", 10, "bold"), fg=COLORS["ink"], bg=COLORS["page"]).pack(
            side="left", padx=(0, 7)
        )
        ttk.Spinbox(controls, textvariable=self.seed_var, from_=0, to=2**31 - 1, width=9).pack(side="left")
        tk.Label(controls, text="Run length", font=("Segoe UI", 10, "bold"), fg=COLORS["ink"], bg=COLORS["page"]).pack(
            side="left", padx=(16, 7)
        )
        ttk.Combobox(
            controls, textvariable=self.duration_var, values=("15 s", "30 s", "60 s"),
            state="readonly", width=8,
        ).pack(side="left")
        self.run_button = tk.Button(
            controls, text="Generate run", command=self._generate_run,
            bg=COLORS["blue"], activebackground="#20585c", activeforeground="white",
            fg="white", relief="flat", bd=0, cursor="hand2",
            font=("Segoe UI", 10, "bold"), padx=15, pady=8,
        )
        self.run_button.pack(side="left", padx=(14, 0))

        panel = tk.Frame(
            content, bg=COLORS["surface"],
            highlightbackground=COLORS["line"], highlightthickness=1,
        )
        panel.grid(row=1, column=0, sticky="nsew")
        panel.grid_columnconfigure(0, weight=1)
        panel.grid_rowconfigure(1, weight=1)
        heading = tk.Frame(panel, bg=COLORS["surface"])
        heading.grid(row=0, column=0, sticky="ew", padx=18, pady=(16, 10))
        heading.grid_columnconfigure(0, weight=1)
        tk.Label(
            heading, text="Straight two-lane road",
            font=("Segoe UI", 14, "bold"), fg=COLORS["ink"], bg=COLORS["surface"],
        ).grid(row=0, column=0, sticky="w")
        tk.Label(
            heading, text="Vehicle-level view · 0–500 m",
            font=("Segoe UI", 9), fg=COLORS["muted"], bg=COLORS["surface"],
        ).grid(row=0, column=1, sticky="e")
        self.canvas = tk.Canvas(panel, height=330, bg="#edf1ee", highlightthickness=0)
        self.canvas.grid(row=1, column=0, sticky="nsew", padx=18)
        self.canvas.bind("<Configure>", lambda _event: self._draw_state())

        legend = tk.Frame(panel, bg=COLORS["surface"])
        legend.grid(row=2, column=0, sticky="ew", padx=18, pady=(10, 4))
        for vehicle_class, color in VEHICLE_COLORS.items():
            item = tk.Frame(legend, bg=COLORS["surface"])
            item.pack(side="left", padx=(0, 14))
            swatch = tk.Canvas(item, width=14, height=10, bg=COLORS["surface"], highlightthickness=0)
            swatch.create_rectangle(1, 1, 13, 9, fill=color, outline=COLORS["ink"])
            swatch.pack(side="left", padx=(0, 5))
            tk.Label(
                item, text=VEHICLE_LABELS[vehicle_class], font=("Segoe UI", 9),
                fg=COLORS["muted"], bg=COLORS["surface"],
            ).pack(side="left")

        metrics = tk.Frame(panel, bg=COLORS["surface"])
        metrics.grid(row=3, column=0, sticky="ew", padx=18, pady=(10, 14))
        for column in range(7):
            metrics.grid_columnconfigure(column, weight=1, uniform="metric")
        self._metric(metrics, 0, "SIMULATION TIME", self.time_var, "s")
        self._metric(metrics, 1, "VEHICLES ON ROAD", self.count_var, "")
        self._metric(metrics, 2, "MEAN SPEED", self.speed_var, "km/h")
        self._metric(metrics, 3, "VEHICLES EXITED", self.exited_var, "")
        self._metric(metrics, 4, "HARD-BRAKING EVENTS", self.braking_var, "")
        self._metric(metrics, 5, "CONTACTS", self.contacts_var, "")
        self._metric(metrics, 6, "LANE CHANGES", self.lane_changes_var, "")

        playback = tk.Frame(content, bg=COLORS["page"])
        playback.grid(row=2, column=0, sticky="ew", pady=(14, 0))
        self.play_button = tk.Button(
            playback, text="▶  Play", command=self._toggle_playback,
            bg=COLORS["surface"], fg=COLORS["ink"], activebackground=COLORS["blue_pale"],
            relief="flat", bd=0, cursor="hand2", font=("Segoe UI", 10, "bold"), padx=13, pady=7,
        )
        self.play_button.pack(side="left")
        self.timeline = ttk.Scale(playback, from_=0, to=0, command=self._scrub)
        self.timeline.pack(side="left", fill="x", expand=True, padx=14)
        tk.Label(
            playback, textvariable=self.status_var, font=("Segoe UI", 9),
            fg=COLORS["muted"], bg=COLORS["page"],
        ).pack(side="right")

        note = tk.Label(
            content,
            text="Prototype only: lane changes use simplified gap and speed-gain checks; overtaking is limited to adjacent lanes. Vehicle mix, reaction delays, and braking are uncalibrated. Contacts report closing speed only, not damage or crash risk; signals and arrivals are not modeled.",
            font=("Segoe UI", 9), fg=COLORS["muted"], bg=COLORS["page"], anchor="w",
        )
        note.grid(row=3, column=0, sticky="ew", pady=(12, 0))

    @staticmethod
    def _metric(parent: tk.Frame, column: int, title: str, value: tk.StringVar, unit: str) -> None:
        card = tk.Frame(parent, bg="#f7f9f7", highlightbackground=COLORS["line"], highlightthickness=1)
        card.grid(row=0, column=column, sticky="ew", padx=(0 if column == 0 else 8, 0))
        tk.Label(card, text=title, font=("Segoe UI", 8, "bold"), fg=COLORS["muted"], bg="#f7f9f7").pack(
            anchor="w", padx=11, pady=(9, 1)
        )
        value_row = tk.Frame(card, bg="#f7f9f7")
        value_row.pack(anchor="w", padx=11, pady=(0, 9))
        tk.Label(value_row, textvariable=value, font=("Segoe UI", 16, "bold"), fg=COLORS["ink"], bg="#f7f9f7").pack(
            side="left"
        )
        if unit:
            tk.Label(value_row, text=unit, font=("Segoe UI", 9), fg=COLORS["muted"], bg="#f7f9f7").pack(
                side="left", padx=(4, 0), pady=(5, 0)
            )

    def _generate_run(self) -> None:
        self._stop_playback()
        try:
            seed = int(self.seed_var.get())
            duration_s = float(self.duration_var.get().split()[0])
            self.states = traffic_micro.run_simulation(duration_s=duration_s, seed=seed)
        except (TypeError, ValueError) as error:
            self.status_var.set(f"Could not generate run: {error}")
            return
        self.current_index = 0
        self.timeline.configure(to=len(self.states) - 1)
        self.timeline.set(0)
        self.status_var.set(f"Seed {seed} · {len(self.states):,} saved frames")
        self._draw_state()

    def _draw_state(self) -> None:
        if not hasattr(self, "canvas"):
            return
        canvas = self.canvas
        canvas.delete("all")
        width = max(canvas.winfo_width(), 500)
        height = max(canvas.winfo_height(), 240)
        left, right = 42, width - 42
        top, bottom = 35, height - 38
        lane_height = (bottom - top) / 2
        canvas.create_rectangle(left, top, right, bottom, fill=COLORS["road"], outline="")
        canvas.create_line(left, top + lane_height, right, top + lane_height, fill=COLORS["road_mark"], dash=(13, 10), width=2)
        canvas.create_line(left, top + 2, right, top + 2, fill="#899397", width=2)
        canvas.create_line(left, bottom - 2, right, bottom - 2, fill="#899397", width=2)
        for fraction in (0, 0.25, 0.5, 0.75, 1):
            x = left + fraction * (right - left)
            canvas.create_line(x, bottom + 7, x, bottom + 12, fill=COLORS["muted"])
            canvas.create_text(x, bottom + 23, text=f"{fraction * 500:.0f} m", fill=COLORS["muted"], font=("Segoe UI", 8))
        if not self.states:
            return

        state = self.states[self.current_index]
        for vehicle in state.vehicles:
            x_center = left + vehicle.position_m / state.config.road_length_m * (right - left)
            lane_center = top + (vehicle.lane_index + 0.5) * lane_height
            half_width = max(3.0, vehicle.length_m / state.config.road_length_m * (right - left) / 2)
            half_height = min(9.0, lane_height * 0.22)
            color = "#c85f55" if vehicle.hard_braking_steps_remaining > 0 else VEHICLE_COLORS[vehicle.vehicle_class]
            canvas.create_rectangle(
                x_center - half_width, lane_center - half_height,
                x_center + half_width, lane_center + half_height,
                fill=color, outline="#26343a", width=1,
            )
            canvas.create_line(
                x_center - half_width * 0.2, lane_center - half_height + 2,
                x_center + half_width * 0.2, lane_center - half_height + 2,
                fill="#526168", width=1,
            )

        metrics = traffic_micro.metrics_snapshot(state)
        self.time_var.set(f"{state.time_s:.1f}")
        self.count_var.set(str(metrics.vehicle_count))
        self.speed_var.set(f"{metrics.mean_speed_km_per_h:.1f}")
        self.exited_var.set(str(metrics.exited_vehicles))
        self.braking_var.set(str(metrics.hard_braking_event_count))
        self.contacts_var.set(str(metrics.contact_event_count))
        self.lane_changes_var.set(str(metrics.lane_change_count))
        self._updating_timeline = True
        self.timeline.set(self.current_index)
        self._updating_timeline = False

    def _scrub(self, raw_value: str) -> None:
        if not self.states or self.playing or self._updating_timeline:
            return
        self.current_index = max(0, min(len(self.states) - 1, round(float(raw_value))))
        self._draw_state()

    def _toggle_playback(self) -> None:
        if self.playing:
            self._stop_playback()
            return
        if not self.states:
            return
        if self.current_index >= len(self.states) - 1:
            self.current_index = 0
        self.playing = True
        self.play_button.configure(text="Ⅱ  Pause")
        self._play_next_frame()

    def _play_next_frame(self) -> None:
        if not self.playing:
            return
        if self.current_index >= len(self.states) - 1:
            self._stop_playback()
            return
        self.current_index = min(self.current_index + 3, len(self.states) - 1)
        self._draw_state()
        self.after_id = self.after(40, self._play_next_frame)

    def _stop_playback(self) -> None:
        self.playing = False
        if self.after_id is not None:
            self.after_cancel(self.after_id)
            self.after_id = None
        if hasattr(self, "play_button"):
            self.play_button.configure(text="▶  Play")


if __name__ == "__main__":
    MicroscopicPreview().mainloop()
