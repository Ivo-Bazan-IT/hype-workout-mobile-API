import { describe, it, expect } from 'vitest';
import {
  calcularCostoEstimado,
  tienePrecio,
  PRECIOS_USD_POR_MILLON,
} from '../../../src/domain/ai/pricing';

describe('pricing', () => {
  it('calcula el costo separando entrada y salida', () => {
    // gpt-4o: 2.5 USD/M entrada, 10 USD/M salida
    // 1M prompt + 1M respuesta = 2.5 + 10
    expect(calcularCostoEstimado('gpt-4o', 1_000_000, 1_000_000)).toBe(12.5);
  });

  it('devuelve null para un modelo sin precio cargado', () => {
    // null y no 0: distinguir "no sé cuánto costó" de "salió gratis" es lo que
    // permite que el reporte avise cuántas rutinas quedaron sin tarifar.
    expect(calcularCostoEstimado('modelo-nuevo-sin-precio', 1000, 1000)).toBeNull();
    expect(tienePrecio('modelo-nuevo-sin-precio')).toBe(false);
  });

  it('no redondea a cero una generación barata', () => {
    // deepseek-chat con pocos tokens cuesta fracciones de centavo: redondear a 2
    // decimales haría que todas las generaciones se registren como 0.
    const costo = calcularCostoEstimado('deepseek-chat', 1000, 500);

    expect(costo).toBeGreaterThan(0);
    expect(costo).toBeLessThan(0.01);
  });

  it('tiene precio cargado para los modelos por defecto de los tres adaptadores', () => {
    // Si alguien cambia un MODELO_POR_DEFECTO y olvida la tabla, el consumo se
    // registraría sin costo y nadie se enteraría hasta ver el reporte vacío.
    expect(tienePrecio('deepseek-chat')).toBe(true);
    expect(tienePrecio('gpt-4o-mini')).toBe(true);
    expect(tienePrecio('claude-3-7-sonnet-20250219')).toBe(true);
  });

  it('todos los precios cargados son positivos', () => {
    for (const [model, precio] of Object.entries(PRECIOS_USD_POR_MILLON)) {
      expect(precio.entrada, `${model} entrada`).toBeGreaterThan(0);
      expect(precio.salida, `${model} salida`).toBeGreaterThan(0);
    }
  });

  it('un consumo de cero tokens cuesta cero', () => {
    expect(calcularCostoEstimado('gpt-4o', 0, 0)).toBe(0);
  });
});
