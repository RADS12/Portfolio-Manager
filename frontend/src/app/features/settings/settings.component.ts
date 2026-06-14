import { Component } from "@angular/core";
import { CommonModule } from "@angular/common";

@Component({
  selector: "app-settings",
  standalone: true,
  imports: [CommonModule],
  template: `
    <div style="padding:40px;font-family:sans-serif">
      <h2>Settings</h2>
      <p>Coming in next session.</p>
    </div>
  `
})
export class SettingsComponent {}
